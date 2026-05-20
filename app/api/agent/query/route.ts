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
  maxTokens: number = 2000,
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

// Paginate through ALL Gmail results for a query
async function fetchAllThreads(
  gmail:      any,
  q:          string,
  seenIds:    Set<string>,
): Promise<any[]> {
  const threads: any[]           = []
  let pageToken: string | undefined = undefined

  do {
    try {
      const listRes: any = await gmail.users.messages.list({
        userId:     'me',
        q,
        maxResults: 500,
        ...(pageToken ? { pageToken } : {}),
      })
      pageToken = listRes.data.nextPageToken

      for (const msg of listRes.data.messages ?? []) {
        if (!msg.threadId || seenIds.has(msg.threadId)) continue
        seenIds.add(msg.threadId)

        try {
          const t = await gmail.users.threads.get({
            userId:          'me',
            id:              msg.threadId,
            format:          'METADATA',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
          })
          const msgs  = t.data.messages ?? []
          const first = msgs[0]
          const h     = first?.payload?.headers ?? []
          const get   = (n: string) =>
            h.find((x: any) => x.name === n)?.value ?? ''

          const content = msgs.map((m: any) => {
            const mh   = m.payload?.headers ?? []
            const from = mh.find((x: any) => x.name === 'From')?.value ?? ''
            return `[${from}]: ${m.snippet ?? ''}`
          }).join('\n')

          threads.push({
            threadId:     msg.threadId,
            subject:      get('Subject'),
            from:         get('From'),
            date:         get('Date'),
            messageCount: msgs.length,
            snippet:      content.slice(0, 600),
            gmailLink:    `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}/${msg.threadId}`,
          })
        } catch { /* skip individual thread */ }
      }
    } catch {
      pageToken = undefined // stop on error
    }
  } while (pageToken)

  return threads
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { query, conversation_id, filters = {} } = await request.json()
  if (!query?.trim()) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  const supabase = getServiceSupabase()

  // Step 1: Get or create conversation
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

  // Step 2: Save user message to Supabase
  await supabase.from('agent_messages').insert({
    conversation_id: convId,
    role:            'user',
    content:         query,
  })

  // Step 3: Get conversation history for context
  const { data: history } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(8)

  // Step 4: Extract Gmail search keywords
  const keywordText = await invokeNova(
    'Extract Gmail search query from user input. Reply JSON only.',
    `Query: "${query}"
${filters.from     ? `From: ${filters.from}` : ''}
${filters.dateFrom ? `After: ${filters.dateFrom}` : ''}
${filters.dateTo   ? `Before: ${filters.dateTo}` : ''}

Return: {"gmail_query": "search terms for Gmail API"}
Keep it simple — 2-4 key words from the query.`,
    100,
  )

  let gmailQuery = query.slice(0, 50)
  try {
    const kw = JSON.parse(keywordText.replace(/```json|```/g, '').trim())
    if (kw.gmail_query) gmailQuery = kw.gmail_query
    if (filters.from)     gmailQuery += ` from:${filters.from}`
    if (filters.dateFrom) gmailQuery += ` after:${filters.dateFrom.replace(/-/g, '/')}`
    if (filters.dateTo)   gmailQuery += ` before:${filters.dateTo.replace(/-/g, '/')}`
  } catch { /* use raw query */ }

  // Step 5: Get ALL visible member IDs
  let memberIds: string[] = [member.id]
  if (member.role === 'delivery_lead') {
    const { data: all } = await supabase
      .from('team_members').select('id').eq('is_active', true)
    memberIds = all?.map((m: any) => m.id) ?? [member.id]
  } else if (isManagerRole(member.role as TeamRole)) {
    const { data: reports } = await supabase
      .from('team_member_reports')
      .select('member_id').eq('manager_id', member.id)
    memberIds = [
      member.id,
      ...(reports?.map((r: any) => r.member_id) ?? []),
    ]
  }

  // Step 6: Search ALL members' Gmail with full pagination
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

      const threads = await fetchAllThreads(gmail, gmailQuery, seenThreadIds)
      allThreads.push(...threads)
    } catch { /* skip member */ }
  }

  // No results
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

  // Step 7: AI analysis
  const threadData = allThreads
    .map((t, i) =>
      `[Thread ${i + 1}] Subject: "${t.subject}" | From: ${t.from} | Date: ${t.date} | ${t.messageCount} messages\n${t.snippet}`
    ).join('\n\n---\n\n')

  const convHistory = (history ?? [])
    .slice(-6)
    .map((m: any) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content.slice(0, 200)}`)
    .join('\n')

  const analysisText = await invokeNova(
    'You are a project intelligence agent. Analyze emails and answer questions. Reply JSON only.',
    `${convHistory ? `Previous conversation:\n${convHistory}\n\n` : ''}User query: "${query}"

${allThreads.length} relevant email threads found:

${threadData}

Reply with this JSON:
{
  "summary": "2-3 paragraph answer to the query with specific names dates and details",
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
    summary: `Analyzed ${allThreads.length} emails for: ${query}`,
    key_findings: [], action_items: [],
    timeline: [], risks: [], next_steps: [],
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

  // Step 8: Save assistant message to Supabase
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
