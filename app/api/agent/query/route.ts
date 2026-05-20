import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { google } from 'googleapis'
import { safeDecrypt } from '@/lib/crypto'
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { isManagerRole, type TeamRole } from '@/lib/roles'

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

// Fetch up to MAX_THREADS threads for one member — all thread details in parallel
async function searchMemberGmail(
  gmail:      any,
  q:          string,
  seenIds:    Set<string>,
  maxThreads = 25,
): Promise<any[]> {
  // One list call — no pagination, keeps latency predictable
  const listRes: any = await gmail.users.messages.list({
    userId:     'me',
    q,
    maxResults: maxThreads,
  })

  const messages: any[] = listRes.data.messages ?? []

  // Deduplicate by threadId before fetching details
  const uniqueThreadIds = messages
    .map((m: any) => m.threadId)
    .filter((id: string) => id && !seenIds.has(id))
    .filter((id: string, i: number, arr: string[]) => arr.indexOf(id) === i)
    .slice(0, maxThreads)

  uniqueThreadIds.forEach((id: string) => seenIds.add(id))

  if (uniqueThreadIds.length === 0) return []

  // Fetch all thread details IN PARALLEL — this is the key speedup
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
    } catch { /* skip malformed */ }
  }

  return threads
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { query, conversation_id, filters = {} } = await request.json()
  if (!query?.trim()) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  const supabase = getServiceSupabase()

  // ── Step 1: Get or create conversation ──────────────
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

  // ── Step 2: Save user message ────────────────────────
  await supabase.from('agent_messages').insert({
    conversation_id: convId,
    role:            'user',
    content:         query,
  })

  // ── Step 3: Conversation history for context ─────────
  const { data: history } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(8)

  // ── Step 4: Extract Gmail search keywords ────────────
  // Run in parallel with member lookup — independent work
  const [keywordText, memberResult] = await Promise.all([
    invokeNova(
      'Extract Gmail search query from user input. Reply JSON only.',
      `Query: "${query}"
${filters.from     ? `From: ${filters.from}` : ''}
${filters.dateFrom ? `After: ${filters.dateFrom}` : ''}
${filters.dateTo   ? `Before: ${filters.dateTo}` : ''}

Return: {"gmail_query": "2-4 key search words only"}`,
      100,
    ),
    // ── Step 5: Get visible member IDs ───────────────────
    (async () => {
      let ids: string[] = [member.id]
      if (member.role === 'delivery_lead') {
        const { data: all } = await supabase
          .from('team_members').select('id').eq('is_active', true)
        ids = all?.map((m: any) => m.id) ?? [member.id]
      } else if (isManagerRole(member.role as TeamRole)) {
        const { data: reports } = await supabase
          .from('team_member_reports')
          .select('member_id').eq('manager_id', member.id)
        ids = [member.id, ...(reports?.map((r: any) => r.member_id) ?? [])]
      }
      return ids
    })(),
  ])

  const memberIds = memberResult

  let gmailQuery = query.slice(0, 50)
  try {
    const kw = JSON.parse(keywordText.replace(/```json|```/g, '').trim())
    if (kw.gmail_query) gmailQuery = kw.gmail_query
    if (filters.from)     gmailQuery += ` from:${filters.from}`
    if (filters.dateFrom) gmailQuery += ` after:${filters.dateFrom.replace(/-/g, '/')}`
    if (filters.dateTo)   gmailQuery += ` before:${filters.dateTo.replace(/-/g, '/')}`
  } catch { /* use raw query */ }

  // ── Step 6: Search all members' Gmail ───────────────
  // Members run sequentially (Gmail rate-limit safety),
  // but thread fetches within each member are parallel.
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

  // ── Step 7: No results ───────────────────────────────
  if (allThreads.length === 0) {
    const msg = `I searched across the team's inboxes for "${query}" but found no relevant emails. Try different keywords or broaden your search.`
    await supabase.from('agent_messages').insert({
      conversation_id: convId, role: 'assistant', content: msg,
    })
    return NextResponse.json({
      conversation_id: convId,
      response: msg, threads: [],
      action_items: [], timeline: [], threads_fetched: 0,
    })
  }

  // ── Step 8: AI analysis ──────────────────────────────
  const threadData = allThreads
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

${allThreads.length} email threads found:

${threadData}

Reply with this JSON:
{
  "summary": "2-3 paragraph answer with specific names, dates, and details",
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
    summary:      `Analyzed ${allThreads.length} emails for: ${query}`,
    key_findings: [], action_items: [],
    timeline:     [], risks: [],      next_steps: [],
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
    `\n_Searched ${allThreads.length} emails across ${memberIds.length} team member${memberIds.length > 1 ? 's' : ''}_`,
  ].filter(Boolean).join('\n')

  // ── Step 9: Save assistant message ──────────────────
  const { data: savedMsg } = await supabase
    .from('agent_messages')
    .insert({
      conversation_id:  convId,
      role:             'assistant',
      content:          responseContent,
      threads_fetched:  allThreads.length,
      threads_analyzed: allThreads.length,
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
    threads:          allThreads,
    action_items:     analysis.action_items ?? [],
    timeline:         analysis.timeline ?? [],
    key_findings:     analysis.key_findings ?? [],
    threads_fetched:  allThreads.length,
  })
}
