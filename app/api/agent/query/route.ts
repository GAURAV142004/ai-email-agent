import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase }
  from '@/lib/auth'
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
    modelId:     process.env.BEDROCK_MODEL_ID
                   ?? 'amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept:      'application/json',
    body:        Buffer.from(body),
  })
  const res    = await bedrock.send(cmd)
  const result = JSON.parse(
    Buffer.from(res.body).toString('utf-8')
  )
  return result.output?.message?.content?.[0]?.text ?? ''
}

// Exhaustive Gmail search across all folders
// Paginates through ALL results — no hard limit
async function searchMemberGmail(
  gmail:     any,
  baseQuery: string,
): Promise<any[]> {
  const threads: any[]        = []
  const seenIds = new Set<string>()

  // Three search passes:
  // 1. General inbox search
  // 2. Sent items (emails WE sent about this topic)
  // 3. CC'd emails (senior added as CC to junior emails)
  const searchPasses = [
    baseQuery,
    `in:sent ${baseQuery}`,
    `cc:me ${baseQuery}`,
  ]

  for (const q of searchPasses) {
    let pageToken: string | undefined = undefined

    // Paginate through ALL pages of results
    do {
      try {
        const listRes: any = await gmail.users.messages.list({
          userId:     'me',
          q,
          maxResults: 500,
          ...(pageToken ? { pageToken } : {}),
        })

        const messages = listRes.data.messages ?? []
        pageToken      = listRes.data.nextPageToken

        // Fetch each unique thread
        for (const msg of messages) {
          if (!msg.threadId) continue
          if (seenIds.has(msg.threadId)) continue
          seenIds.add(msg.threadId)

          try {
            const thread = await gmail.users.threads.get({
              userId: 'me',
              id:     msg.threadId,
              format: 'FULL',
            })

            const msgs    = thread.data.messages ?? []
            const first   = msgs[0]
            const headers = first?.payload?.headers ?? []
            const get = (n: string) =>
              headers.find((h: any) =>
                h.name?.toLowerCase() === n.toLowerCase()
              )?.value ?? ''

            // Extract full content from every message
            const fullContent = msgs.map((m: any) => {
              const mh   = m.payload?.headers ?? []
              const hget = (n: string) =>
                mh.find((h: any) =>
                  h.name?.toLowerCase() === n.toLowerCase()
                )?.value ?? ''

              // Extract body — try parts first, then body
              let body = m.snippet ?? ''
              const extractText = (payload: any): string => {
                if (!payload) return ''
                if (payload.mimeType === 'text/plain' &&
                    payload.body?.data) {
                  try {
                    return Buffer.from(
                      payload.body.data, 'base64'
                    ).toString('utf-8').slice(0, 2000)
                  } catch { return '' }
                }
                if (payload.parts) {
                  for (const part of payload.parts) {
                    const text = extractText(part)
                    if (text) return text
                  }
                }
                return ''
              }
              const extracted = extractText(m.payload)
              if (extracted) body = extracted

              return [
                `--- Message ---`,
                `From: ${hget('from')}`,
                hget('to') ? `To: ${hget('to')}` : '',
                hget('cc') ? `CC: ${hget('cc')}` : '',
                `Date: ${hget('date')}`,
                `Body: ${body.slice(0, 1500)}`,
              ].filter(Boolean).join('\n')
            }).join('\n\n')

            threads.push({
              threadId:     msg.threadId,
              subject:      get('subject'),
              from:         get('from'),
              to:           get('to'),
              cc:           get('cc'),
              date:         get('date'),
              messageCount: msgs.length,
              fullContent:  fullContent.slice(0, 4000),
              snippet:      msgs
                .map((m: any) => m.snippet ?? '')
                .join(' | ')
                .slice(0, 500),
              gmailLink:
                `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`,
            })
          } catch { /* skip individual thread */ }
        }
      } catch {
        pageToken = undefined // stop pagination on error
      }
    } while (pageToken)
  }

  return threads
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json(
    { error: 'Unauthorized' }, { status: 401 })

  const { query, conversation_id, filters = {} } =
    await request.json()

  if (!query?.trim()) return NextResponse.json(
    { error: 'Query required' }, { status: 400 })

  const supabase = getServiceSupabase()

  // ── Step 1: Get/create conversation ─────────
  let convId = conversation_id
  if (!convId) {
    const { data: conv } = await supabase
      .from('agent_conversations')
      .insert({
        member_id: member.id,
        title:     query.slice(0, 60),
      })
      .select('id')
      .single()
    convId = conv?.id
  } else {
    await supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId)
  }

  await supabase.from('agent_messages').insert({
    conversation_id: convId,
    role:            'user',
    content:         query,
  })

  // ── Step 2: Conversation history ────────────
  const { data: history } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(10)

  const convHistory = (history ?? [])
    .slice(-6)
    .map(m =>
      `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content.slice(0, 300)}`
    ).join('\n')

  // ── Step 3: Analyze query intent ────────────
  const intentText = await invokeNova(
    'Analyze user query for email search. Reply JSON only.',
    `${convHistory ? `Conversation so far:\n${convHistory}\n\n` : ''}
User query: "${query}"

Return JSON:
{
  "is_vague": true/false,
  "clarification_question": "ask this if vague, else null",
  "gmail_queries": ["best search term", "alternative 1", "alternative 2"],
  "intent": "what user wants to know in one sentence",
  "date_hint": "after:YYYY/MM/DD if date mentioned, else null"
}

is_vague = true ONLY if query has NO specific topic/project/client/person.
"project update" = vague (no project name)
"Infosys API integration status" = NOT vague
"emails from last week" = vague (no topic)
"what did John say about payment" = NOT vague

gmail_queries: extract 2-3 search keyword variations.
"Infosys integration project status" →
  ["Infosys integration", "Infosys project", "Infosys API"]`,
    400,
  )

  let intent: any = {
    is_vague:      false,
    gmail_queries: [query.slice(0, 50)],
    intent:        query,
  }
  try {
    intent = JSON.parse(
      intentText.replace(/```json|```/g, '').trim()
    )
  } catch { /* use defaults */ }

  // ── Step 4: Clarification if vague ──────────
  if (intent.is_vague && intent.clarification_question) {
    await supabase.from('agent_messages').insert({
      conversation_id: convId,
      role:            'assistant',
      content:         intent.clarification_question,
      threads_fetched: 0,
    })
    return NextResponse.json({
      conversation_id:     convId,
      response:            intent.clarification_question,
      threads:             [],
      action_items:        [],
      timeline:            [],
      threads_fetched:     0,
      needs_clarification: true,
    })
  }

  // ── Step 5: Get ALL visible member IDs ───────
  let memberIds: string[] = [member.id]

  if (member.role === 'delivery_lead') {
    const { data: all } = await supabase
      .from('team_members')
      .select('id')
      .eq('is_active', true)
    memberIds = all?.map((m: any) => m.id) ?? [member.id]
  } else if (isManagerRole(member.role as TeamRole)) {
    const { data: reports } = await supabase
      .from('team_member_reports')
      .select('member_id')
      .eq('manager_id', member.id)
    memberIds = [
      member.id,
      ...(reports?.map((r: any) => r.member_id) ?? []),
    ]
  }

  // ── Step 6: Exhaustive search all members ───
  const allThreads: any[]         = []
  const globalSeen = new Set<string>()

  // Build final query list with filters
  const finalQueries = (intent.gmail_queries ?? [query])
    .slice(0, 3)
    .map((q: string) => {
      let fq = q
      if (filters.from)     fq += ` from:${filters.from}`
      if (filters.dateFrom) fq += ` after:${filters.dateFrom.replace(/-/g, '/')}`
      if (filters.dateTo)   fq += ` before:${filters.dateTo.replace(/-/g, '/')}`
      if (intent.date_hint) fq += ` ${intent.date_hint}`
      return fq
    })

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

      for (const q of finalQueries) {
        const threads = await searchMemberGmail(gmail, q)
        for (const t of threads) {
          if (globalSeen.has(t.threadId)) continue
          globalSeen.add(t.threadId)
          allThreads.push({ ...t, memberId: membId })
        }
      }
    } catch { /* skip member */ }
  }

  // ── Step 7: No results ───────────────────────
  if (allThreads.length === 0) {
    const msg =
      `I searched exhaustively across all team members' inboxes, sent folders, and CC'd emails for "${query}" but found no relevant emails.\n\n` +
      `Suggestions:\n• Use the exact project or client name\n• Try a broader keyword\n• Use date filters to narrow the range\n• Check if the Gmail accounts are properly connected`

    await supabase.from('agent_messages').insert({
      conversation_id: convId, role: 'assistant', content: msg,
    })
    return NextResponse.json({
      conversation_id: convId, response: msg,
      threads: [], action_items: [], timeline: [],
      threads_fetched: 0,
    })
  }

  // ── Step 8: Deep intelligent analysis ───────
  // Sort by date newest first
  const sorted = allThreads.sort((a, b) => {
    try {
      return new Date(b.date).getTime() -
             new Date(a.date).getTime()
    } catch { return 0 }
  })

  // Use top 30 most recent threads for analysis
  // (sorted by date so most relevant recent first)
  const analysisThreads = sorted.slice(0, 30)

  const threadData = analysisThreads
    .map((t, i) =>
      `[EMAIL ${i + 1}]
Subject: "${t.subject}"
From: ${t.from}
To: ${t.to || 'N/A'}
CC: ${t.cc || 'none'}
Date: ${t.date}
Thread size: ${t.messageCount} messages
Content:
${t.fullContent}`
    ).join('\n\n════════════════\n\n')

  const analysisText = await invokeNova(
    'You are an expert project intelligence agent with deep knowledge of business communication. Analyze email threads thoroughly and provide actionable insights. Be specific, analytical, and comprehensive. Reply with valid JSON only.',
    `${convHistory ? `CONVERSATION HISTORY:\n${convHistory}\n\n` : ''}
USER QUERY: "${query}"
INTENT: ${intent.intent}

Total emails found: ${sorted.length}
Analyzing top ${analysisThreads.length} most recent:

${threadData}

Analyze ALL emails thoroughly. Your job:
1. Answer the user's EXACT question
2. Track the full timeline of this project/topic
3. Identify what is DONE, IN PROGRESS, BLOCKED, PENDING
4. Note every person involved and their role/responsibility
5. Find any emails that show delays, issues, or risks
6. Extract every concrete action item mentioned

Reply with this JSON:
{
  "summary": "4-6 paragraph comprehensive answer to the user query. Tell the complete story: what started, what happened, where things stand today. Mention real names, dates, email subjects.",
  "current_status": "Single sentence: current state of the project/topic",
  "key_findings": [
    "Specific finding with person name and date",
    "Another finding"
  ],
  "open_issues": [
    "Specific unresolved issue — who needs to do what"
  ],
  "action_items": [
    {
      "task": "Specific task",
      "owner": "Name or email of responsible person",
      "due_date": "YYYY-MM-DD or null",
      "priority": "high|medium|low",
      "email_ref": "Subject of email where this was mentioned"
    }
  ],
  "timeline": [
    {
      "date": "YYYY-MM-DD",
      "description": "What happened",
      "from_email": "Who sent it",
      "type": "sent|received|milestone"
    }
  ],
  "blockers": [
    "Specific blocker with context from emails"
  ],
  "risks": [
    "Specific risk identified from email patterns"
  ],
  "next_steps": [
    "Specific next step with responsible person"
  ]
}`,
    3000,
  )

  let analysis: any = {
    summary:        `Analyzed ${sorted.length} emails about: ${query}`,
    current_status: 'See details below',
    key_findings:   [],
    open_issues:    [],
    action_items:   [],
    timeline:       [],
    blockers:       [],
    risks:          [],
    next_steps:     [],
  }
  try {
    analysis = JSON.parse(
      analysisText.replace(/```json|```/g, '').trim()
    )
  } catch { /* use defaults */ }

  // Build rich formatted response
  const sections = [
    analysis.summary ?? '',
    analysis.current_status
      ? `\n📊 **Current Status:** ${analysis.current_status}`
      : '',
    analysis.key_findings?.length
      ? `\n🔍 **Key Findings:**\n${analysis.key_findings.map((f: string) => `• ${f}`).join('\n')}`
      : '',
    analysis.open_issues?.length
      ? `\n⚠️ **Open Issues:**\n${analysis.open_issues.map((i: string) => `• ${i}`).join('\n')}`
      : '',
    analysis.blockers?.length
      ? `\n🚫 **Blockers:**\n${analysis.blockers.map((b: string) => `• ${b}`).join('\n')}`
      : '',
    analysis.next_steps?.length
      ? `\n➡️ **Next Steps:**\n${analysis.next_steps.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}`
      : '',
    `\n\n_Searched ${sorted.length} emails across ${memberIds.length} team member inboxes_`,
  ].filter(Boolean).join('\n')

  const { data: savedMsg } = await supabase
    .from('agent_messages')
    .insert({
      conversation_id:  convId,
      role:             'assistant',
      content:          sections,
      threads_fetched:  sorted.length,
      threads_analyzed: analysisThreads.length,
      action_items:     analysis.action_items ?? [],
      timeline:         analysis.timeline     ?? [],
    })
    .select('id')
    .single()

  return NextResponse.json({
    conversation_id:  convId,
    message_id:       savedMsg?.id,
    response:         sections,
    current_status:   analysis.current_status,
    threads:          sorted,
    action_items:     analysis.action_items ?? [],
    timeline:         analysis.timeline     ?? [],
    key_findings:     analysis.key_findings ?? [],
    open_issues:      analysis.open_issues  ?? [],
    blockers:         analysis.blockers     ?? [],
    next_steps:       analysis.next_steps   ?? [],
    threads_fetched:  sorted.length,
  })
}
