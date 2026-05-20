import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { google } from 'googleapis'
import { safeDecrypt } from '@/lib/crypto'
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { isManagerRole, VISIBILITY_MAP, type TeamRole } from '@/lib/roles'

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

async function invokeNova(
  system:    string,
  user:      string,
  maxTokens = 2000,
): Promise<string> {
  const body = JSON.stringify({
    messages: [{ role: 'user', content: [{ text: user }] }],
    system:   [{ text: system }],
    inferenceConfig: { maxTokens, temperature: 0.1 },
  })
  const cmd = new InvokeModelCommand({
    modelId:     process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept:      'application/json',
    body:        Buffer.from(body),
  })
  const res    = await bedrock.send(cmd)
  const result = JSON.parse(Buffer.from(res.body).toString('utf-8'))
  return result.output?.message?.content?.[0]?.text ?? ''
}

// ── Hierarchy: logged-in user + direct juniors only ──────────────
// Uses VISIBILITY_MAP as the authority — guarantees no upward search
// even if team_member_reports has stale/incorrect data.
async function getSearchableMemberIds(
  member:   any,
  supabase: any,
): Promise<string[]> {
  const visibleRoles = VISIBILITY_MAP[member.role as TeamRole] ?? [member.role as string]

  // delivery_lead sits at the top — can see all streams
  if (member.role === 'delivery_lead') {
    const { data: all } = await supabase
      .from('team_members')
      .select('id')
      .eq('is_active', true)
    return all?.map((m: any) => m.id) ?? [member.id]
  }

  // Senior roles (senior_ba / senior_mis / senior_developer):
  // search self + direct reports, but ONLY those whose role
  // is in this user's VISIBILITY_MAP (prevents upward search)
  if (isManagerRole(member.role as TeamRole)) {
    const { data: reports } = await supabase
      .from('team_member_reports')
      .select('member_id')
      .eq('manager_id', member.id)

    const reportIds = reports?.map((r: any) => r.member_id) ?? []

    if (reportIds.length > 0) {
      // Cross-check: only keep report IDs whose role is visible to current user
      const { data: validMembers } = await supabase
        .from('team_members')
        .select('id')
        .in('id', reportIds)
        .in('role', visibleRoles)
        .eq('is_active', true)

      return [member.id, ...(validMembers?.map((m: any) => m.id) ?? [])]
    }

    return [member.id]
  }

  // ba / mis / developer — only their own inbox
  return [member.id]
}

// ── Gmail: fetch up to maxThreads in parallel ────────────────────
async function searchMemberGmail(
  gmail:      any,
  q:          string,
  seenIds:    Set<string>,
  maxThreads = 25,
): Promise<any[]> {
  const listRes: any = await gmail.users.messages.list({
    userId:     'me',
    q,
    maxResults: maxThreads,
  })

  const messages: any[] = listRes.data.messages ?? []
  const uniqueThreadIds = messages
    .map((m: any) => m.threadId)
    .filter((id: string) => id && !seenIds.has(id))
    .filter((id: string, i: number, arr: string[]) => arr.indexOf(id) === i)
    .slice(0, maxThreads)

  uniqueThreadIds.forEach((id: string) => seenIds.add(id))
  if (uniqueThreadIds.length === 0) return []

  // Fetch all thread details in parallel — eliminates the serial bottleneck
  const results = await Promise.allSettled(
    uniqueThreadIds.map((threadId: string) =>
      gmail.users.threads.get({
        userId:          'me',
        id:              threadId,
        format:          'METADATA',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      })
    )
  )

  const threads: any[] = []
  for (const res of results) {
    if (res.status !== 'fulfilled') continue
    try {
      const msgs  = res.value.data.messages ?? []
      const first = msgs[0]
      const h     = first?.payload?.headers ?? []
      const get   = (n: string) =>
        h.find((x: any) => x.name === n)?.value ?? ''

      const snippet = msgs
        .map((m: any) => {
          const from = (m.payload?.headers ?? [])
            .find((x: any) => x.name === 'From')?.value ?? ''
          return `[${from}]: ${m.snippet ?? ''}`
        })
        .join('\n')
        .slice(0, 600)

      threads.push({
        threadId:     res.value.data.id,
        subject:      get('Subject'),
        from:         get('From'),
        date:         get('Date'),
        messageCount: msgs.length,
        snippet,
        gmailLink: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}/${res.value.data.id}`,
      })
    } catch { /* skip malformed thread */ }
  }

  return threads
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { query, conversation_id, filters = {} } = await request.json()
  if (!query?.trim()) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  const supabase = getServiceSupabase()

  // ── Step 1: Get or create conversation ──────────────────────────
  let convId = conversation_id
  if (!convId) {
    const { data: conv } = await supabase
      .from('agent_conversations')
      .insert({ member_id: member.id, title: query.slice(0, 60) })
      .select('id')
      .single()
    convId = conv?.id
  } else {
    await supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId)
  }

  // ── Step 2: Save user message ────────────────────────────────────
  await supabase.from('agent_messages').insert({
    conversation_id: convId,
    role:            'user',
    content:         query,
  })

  // ── Step 3: Conversation history ────────────────────────────────
  const { data: history } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(8)

  // ── Step 4+5: Extract Gmail query AND get member IDs — parallel ─
  const [keywordText, memberIds] = await Promise.all([
    // Build a precise Gmail query that excludes newsletters/social noise
    invokeNova(
      'Extract a Gmail search query. Reply JSON only.',
      `User query: "${query}"

Your job: extract the core entity (company, person, project) and build a Gmail search query.

Examples:
"show all communication with Infosys Springboard"
→ {"gmail_query": "infosys springboard"}

"what did John say about the payment API"
→ {"gmail_query": "john payment API"}

"project status for Acme Corp integration"
→ {"gmail_query": "\\"Acme Corp\\" integration"}

"emails from priya about module 2"
→ {"gmail_query": "from:priya module 2"}

Rules:
- Extract 1-3 key terms only (company name, person name, project name)
- Use from:<name> if user asks about a specific sender
- Put multi-word company/project names in escaped quotes
- Do NOT include filter words like "show", "emails", "communication", "status"
- Do NOT add category or unsubscribe filters here (added automatically)

Return: {"gmail_query": "..."}`,
      150,
    ),
    // Get searchable members respecting hierarchy
    getSearchableMemberIds(member, supabase),
  ])

  // Build the final Gmail query:
  // core keywords + exclude promotional/social/newsletter noise
  let coreQuery = query.slice(0, 50)
  try {
    const kw = JSON.parse(keywordText.replace(/```json|```/g, '').trim())
    if (kw.gmail_query?.trim()) coreQuery = kw.gmail_query.trim()
  } catch { /* keep raw query */ }

  // Append caller-specified filters
  if (filters.from)     coreQuery += ` from:${filters.from}`
  if (filters.dateFrom) coreQuery += ` after:${filters.dateFrom.replace(/-/g, '/')}`
  if (filters.dateTo)   coreQuery += ` before:${filters.dateTo.replace(/-/g, '/')}`

  // Always strip promotions / social / newsletter noise
  const gmailQuery = `${coreQuery} -category:promotions -category:social -unsubscribe`

  // ── Step 6: Search all visible members' Gmail ────────────────────
  // Members run sequentially (Gmail per-user rate limits);
  // thread detail fetches within each member run in parallel.
  const allThreads: any[]          = []
  const seenThreadIds = new Set<string>()

  for (const membId of memberIds) {
    try {
      const { data: tok } = await supabase
        .from('member_gmail_tokens')
        .select('access_token, refresh_token')
        .eq('member_id', membId)
        .single()
      if (!tok) continue

      const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      )
      auth.setCredentials({
        access_token:  safeDecrypt(tok.access_token),
        refresh_token: safeDecrypt(tok.refresh_token),
      })
      const gmail = google.gmail({ version: 'v1', auth })

      const threads = await searchMemberGmail(gmail, gmailQuery, seenThreadIds, 25)
      allThreads.push(...threads)
    } catch { /* skip member on auth/network error */ }
  }

  // ── Step 7: No results ───────────────────────────────────────────
  if (allThreads.length === 0) {
    const msg = `No emails found for "${query}" across ${memberIds.length} team member inbox${memberIds.length > 1 ? 'es' : ''}. Try using the exact company or project name, or adjust your date filters.`
    await supabase.from('agent_messages').insert({
      conversation_id: convId, role: 'assistant', content: msg,
    })
    return NextResponse.json({
      conversation_id: convId, response: msg,
      threads: [], action_items: [], timeline: [], threads_fetched: 0,
    })
  }

  // ── Step 8: AI relevance filter ─────────────────────────────────
  // Drop newsletters, LinkedIn notifications, automated alerts, and
  // anything unrelated to the user's actual query — before analysis.
  const threadList = allThreads
    .map((t, i) => `[${i}] From: ${t.from} | Subject: "${t.subject}"`)
    .join('\n')

  const filterText = await invokeNova(
    'You filter email search results for relevance. Reply JSON only.',
    `User searched for: "${query}"

Identify which threads below are GENUINE business emails directly about this topic.

EXCLUDE:
- LinkedIn notifications, job alerts, profile views
- Newsletters, marketing, promotional emails
- Automated system alerts (noreply, no-reply, do-not-reply)
- Subscription digests, app notifications
- Anything not directly related to the query topic

INCLUDE:
- Real person-to-person emails about the queried company/project/person
- Meeting emails, status updates, deliverable discussions

Threads:
${threadList}

Return JSON: {"keep": [0, 2, 5]} — list of indices to keep.
If unsure, include it. Only exclude obvious noise.`,
    200,
  )

  let relevantThreads = allThreads
  try {
    const filter      = JSON.parse(filterText.replace(/```json|```/g, '').trim())
    const keepIndices = new Set<number>(filter.keep ?? [])
    if (keepIndices.size > 0) {
      relevantThreads = allThreads.filter((_, i) => keepIndices.has(i))
    }
  } catch { /* keep all if filter fails to parse */ }

  // ── Step 9: No relevant results after filtering ──────────────────
  if (relevantThreads.length === 0) {
    const msg = `Found ${allThreads.length} emails matching "${query}" but all appeared to be newsletters or unrelated content. Try using the exact company or project name for better results.`
    await supabase.from('agent_messages').insert({
      conversation_id: convId, role: 'assistant', content: msg,
    })
    return NextResponse.json({
      conversation_id: convId, response: msg,
      threads: [], action_items: [], timeline: [], threads_fetched: 0,
    })
  }

  // ── Step 10: AI analysis of relevant threads ─────────────────────
  const threadData = relevantThreads
    .map((t, i) =>
      `[Thread ${i + 1}] Subject: "${t.subject}" | From: ${t.from} | Date: ${t.date} | ${t.messageCount} messages\n${t.snippet}`
    ).join('\n\n---\n\n')

  const convHistory = (history ?? [])
    .slice(-6)
    .map((m: any) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content.slice(0, 200)}`)
    .join('\n')

  const analysisText = await invokeNova(
    'You are a project intelligence agent. Analyze emails and answer questions concisely. Reply JSON only.',
    `${convHistory ? `Previous conversation:\n${convHistory}\n\n` : ''}User query: "${query}"

${relevantThreads.length} relevant email threads:

${threadData}

Reply with this JSON:
{
  "summary": "2-3 paragraph answer with specific names, dates, and details from the emails",
  "status": "one sentence current status",
  "key_findings": ["finding 1", "finding 2"],
  "action_items": [{"task":"","owner":null,"due_date":null,"priority":"medium","email_ref":null}],
  "timeline": [{"date":"YYYY-MM-DD","description":"","from_email":null,"type":"sent"}],
  "risks": ["risk 1"],
  "next_steps": ["step 1"]
}`,
    2000,
  )

  let analysis: any = {
    summary:      `Analyzed ${relevantThreads.length} relevant emails for: ${query}`,
    key_findings: [], action_items: [],
    timeline:     [], risks:         [], next_steps: [],
  }
  try {
    analysis = JSON.parse(analysisText.replace(/```json|```/g, '').trim())
  } catch { /* use default */ }

  const responseContent = [
    analysis.summary,
    analysis.key_findings?.length
      ? `\n**Key Findings:**\n${analysis.key_findings.map((f: string) => `• ${f}`).join('\n')}`
      : '',
    analysis.risks?.length
      ? `\n**Risks:**\n${analysis.risks.map((r: string) => `⚠️ ${r}`).join('\n')}`
      : '',
    analysis.next_steps?.length
      ? `\n**Next Steps:**\n${analysis.next_steps.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}`
      : '',
    `\n_${relevantThreads.length} relevant emails from ${allThreads.length} found · ${memberIds.length} inbox${memberIds.length > 1 ? 'es' : ''} searched_`,
  ].filter(Boolean).join('\n')

  // ── Step 11: Save assistant message ─────────────────────────────
  const { data: savedMsg } = await supabase
    .from('agent_messages')
    .insert({
      conversation_id:  convId,
      role:             'assistant',
      content:          responseContent,
      threads_fetched:  relevantThreads.length,
      threads_analyzed: relevantThreads.length,
      action_items:     analysis.action_items ?? [],
      timeline:         analysis.timeline ?? [],
    })
    .select('id')
    .single()

  return NextResponse.json({
    conversation_id:  convId,
    message_id:       savedMsg?.id,
    response:         responseContent,
    status:           analysis.status,
    threads:          relevantThreads,
    action_items:     analysis.action_items ?? [],
    timeline:         analysis.timeline ?? [],
    key_findings:     analysis.key_findings ?? [],
    threads_fetched:  relevantThreads.length,
  })
}
