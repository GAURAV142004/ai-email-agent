import { NextRequest, NextResponse }               from 'next/server'
import { getConsentedMember, getServiceSupabase }  from '@/lib/auth'
import { searchKB, searchAttachments }             from '@/lib/kb/search'
import { checkKBAccess, checkResponseSafety }      from '@/lib/compliance/access-guard'
import { logKBQuery }                              from '@/lib/compliance/audit-logger'
import { checkRateLimit }                          from '@/lib/rate-limit'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import type { SupabaseClient }                     from '@supabase/supabase-js'
import type { KBSearchResult, AttachmentSearchResult } from '@/lib/supabase/types'
import type { TeamRole }                           from '@/lib/roles'

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0'

type HistoryMsg = { role: 'user' | 'assistant'; content: string }

// ── Load conversation history ────────────────────────────────────────────────
async function fetchHistory(supabase: SupabaseClient, convId: string): Promise<HistoryMsg[]> {
  const { data } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(14)  // 7 turns

  return (data ?? []).filter(
    (m): m is HistoryMsg => m.role === 'user' || m.role === 'assistant',
  )
}

// ── Build an enriched search query from conversation context ─────────────────
// Short / vague messages ("and the deadline?", "tell me more", "who owns it?")
// get enriched with the last user+assistant exchange so vector search finds
// the right KB entries even without explicit topic keywords.
function buildSearchQuery(question: string, history: HistoryMsg[]): string {
  const words = question.trim().split(/\s+/).length

  if (words <= 6 && history.length >= 2) {
    const lastUser = [...history].reverse().find(m => m.role === 'user')
    const lastBot  = [...history].reverse().find(m => m.role === 'assistant')
    const ctx      = [
      lastUser?.content?.slice(0, 150) ?? '',
      lastBot?.content?.slice(0, 200)  ?? '',
    ].filter(Boolean).join(' ')
    return `${question} ${ctx}`.trim()
  }

  return question
}

// ── Detect file export intent ────────────────────────────────────────────────
const FILE_PATTERNS = [
  /\b(export|download|generate|create|make|give me|send me|produce)\b.*\b(report|excel|xlsx|csv|pdf|sheet|spreadsheet|document|file)\b/i,
  /\b(excel|xlsx|csv|pdf|spreadsheet)\b.*\b(report|summary|list|data)\b/i,
  /\b(report|summary)\b.*\b(excel|xlsx|csv|pdf|file|download)\b/i,
]
function wantsFile(text: string): boolean {
  return FILE_PATTERNS.some(p => p.test(text))
}

// ── Core AI call ─────────────────────────────────────────────────────────────
async function callAI(
  messages: Array<{ role: string; content: Array<{ text: string }> }>,
  systemText: string,
  maxTokens = 1400,
): Promise<{ text: string; tokensUsed: number }> {
  const body   = JSON.stringify({
    messages,
    system:          [{ text: systemText }],
    inferenceConfig: { maxTokens, temperature: 0.25 },
  })
  const resp   = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID, contentType: 'application/json', accept: 'application/json',
    body: Buffer.from(body),
  }))
  const parsed = JSON.parse(Buffer.from(resp.body).toString('utf-8'))
  return {
    text:       parsed.output?.message?.content?.[0]?.text?.trim() ?? '',
    tokensUsed: (parsed.usage?.inputTokens ?? 0) + (parsed.usage?.outputTokens ?? 0),
  }
}

// ── Build KB context string ───────────────────────────────────────────────────
function buildKBContext(emails: KBSearchResult[], attachments: AttachmentSearchResult[]): string {
  const emailPart = emails.map((r, i) => {
    const e = r.entry
    return [
      `[Email ${i + 1} | ${r.memberName} | ${e.detected_project ?? 'Unknown project'} | ${e.email_date ? new Date(e.email_date).toLocaleDateString('en-IN') : 'Unknown date'}]`,
      `Summary: ${e.summary}`,
      e.key_points?.length   ? `Key facts: ${e.key_points.join(' • ')}`                                          : null,
      e.action_items?.length ? `Action items: ${(e.action_items as any[]).map((a: any) => `${a.owner_hint ?? 'Team'} → ${a.task}${a.due_date_hint ? ` (by ${a.due_date_hint})` : ''}`).join(' | ')}` : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const docPart = attachments.map((r, i) => {
    const a = r.attachment
    return [
      `[Doc ${i + 1} | ${a.filename} | shared by ${r.memberName} | ${a.email_date ? new Date(a.email_date).toLocaleDateString('en-IN') : 'Unknown date'}]`,
      `Summary: ${a.summary ?? 'No summary'}`,
      a.key_points?.length ? `Key facts: ${a.key_points.join(' • ')}` : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  return [
    emailPart ? `=== EMAILS ===\n${emailPart}` : null,
    docPart   ? `=== DOCUMENTS ===\n${docPart}` : null,
  ].filter(Boolean).join('\n\n')
}

// ── Synthesize response ──────────────────────────────────────────────────────
async function synthesize(
  question:     string,
  kbContext:    string,
  history:      HistoryMsg[],
  totalSources: number,
  requestsFile: boolean,
): Promise<{ text: string; tokensUsed: number }> {
  const system = `You are an intelligent project knowledge assistant for a software delivery team.
Your knowledge comes from the team's synced project emails and documents shown in KB Data below.

=== CORE BEHAVIOUR ===
1. Understand the user's INTENT from natural language — don't require precise keywords.
   "What's cooking with Infosys?" = project status for Infosys.
   "Any updates on the API issue?" = status of API-related problems.
   "Who's on it?" = who owns the last discussed task.
2. Use CONVERSATION HISTORY to resolve references like "that task", "this project", "them", "it".
3. If the question is genuinely ambiguous even with history, ask exactly ONE specific clarifying question. Never ask multiple questions.
4. If KB data has the answer, state it directly. No hedging ("it appears", "it seems", "it was mentioned").
5. If KB data does NOT have the answer, say: "I don't have that information in the knowledge base." Then suggest what the user could try ("try asking about X instead" or "sync the KB first").

=== FORMAT RULES ===
- Simple fact → 1-3 sentences.
- Multiple items (3+) → bullet list with owner → task → date format for action items.
- Never start with "Certainly!", "Great question!", "Of course!".
- Never end with "I hope this helps!", "Let me know if you need anything else!", "Feel free to ask!".
- No filler phrases: "In summary", "Overall", "Moving forward", "To summarize".
${requestsFile ? `\n=== FILE EXPORT MODE ===\nThe user wants an exported file. Structure your response with clear headers (##), tables where data is tabular, and bullet lists. This will be converted to a downloadable file. Be thorough and include all relevant data from the KB.` : ''}

=== SCOPE ===
Only use project/work information. Never reveal personal details about team members.
If asked about personal matters, politely redirect to project topics.`

  const msgs: Array<{ role: string; content: Array<{ text: string }> }> = []

  // Include up to 8 history messages (4 turns)
  for (const m of history.slice(-8)) {
    msgs.push({ role: m.role, content: [{ text: m.content }] })
  }

  // Current turn with KB context
  const userText = totalSources > 0
    ? `Question: ${question}\n\nKB Data (${totalSources} sources):\n${kbContext}\n\nAnswer based on the above:`
    : `Question: ${question}\n\n(No matching KB entries found for this query.)\n\nRespond helpfully:`

  msgs.push({ role: 'user', content: [{ text: userText }] })

  return callAI(msgs, system, requestsFile ? 2000 : 1400)
}

// ── Response type detection ───────────────────────────────────────────────────
function detectResponseType(text: string): string {
  if (/\|.+\|.+\|/.test(text) && text.includes('---')) return 'table'
  if (/^#{1,3}\s/m.test(text))                          return 'report'
  if (/\b(Q[1-4]|20\d\d)\b/i.test(text))               return 'timeline'
  return 'text'
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getConsentedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized or consent not given' }, { status: 401 })

  const rl = checkRateLimit(`agent:${member.id}`, 30, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    )
  }

  const body           = await request.json().catch(() => ({}))
  const question       = (body?.question ?? '').trim()
  const conversationId = body?.conversationId as string | undefined
  const explicitFormat = body?.docFormat as string | undefined   // 'xlsx' | 'csv' | 'pdf'

  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 })
  if (question.length > 2000) return NextResponse.json({ error: 'Question too long (max 2000 chars)' }, { status: 400 })

  const supabase = getServiceSupabase()

  // ── Mentioned member detection (for scoped search) ────────────────────────
  const { data: allMembers } = await supabase
    .from('team_members').select('id, name, role').eq('is_active', true)
  const mentioned = (allMembers ?? []).find(
    (m: any) => question.toLowerCase().includes(m.name.toLowerCase()),
  ) as { id: string; name: string; role: TeamRole } | undefined

  // ── Compliance check ──────────────────────────────────────────────────────
  const access = checkKBAccess({ viewerRole: member.role, queryText: question, targetMemberRole: mentioned?.role })
  if (!access.allowed) {
    await logKBQuery(supabase, {
      queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id,
      wasBlocked: true, blockReason: access.blockReason ?? undefined, personalTopicsFound: access.personalTopicsFound,
    })
    return NextResponse.json({
      answer: 'That query touches on personal topics outside the scope of the project knowledge base.',
      wasBlocked: true, responseType: 'text', kbEntriesUsed: 0, projectClusters: [], tokensUsed: 0,
    })
  }

  // ── Load conversation history in parallel with member check ───────────────
  const history = conversationId ? await fetchHistory(supabase, conversationId) : []

  // ── Build enriched search query ───────────────────────────────────────────
  const searchQuery  = buildSearchQuery(question, history)
  const requestsFile = !!(explicitFormat || wantsFile(question))

  // ── KB search (emails + attachments in parallel) ──────────────────────────
  const searchParams = {
    query: searchQuery, viewerRole: member.role, viewerMemberId: member.id,
    memberIds: mentioned ? [mentioned.id] : undefined,
  }

  const [emailResults, attachmentResults] = await Promise.all([
    searchKB(supabase,          { ...searchParams, limit: 12 }),
    searchAttachments(supabase, { ...searchParams, limit: 8  }),
  ])

  const totalSources = emailResults.length + attachmentResults.length
  const kbContext    = totalSources > 0 ? buildKBContext(emailResults, attachmentResults) : ''

  // ── AI synthesis ──────────────────────────────────────────────────────────
  let synth: { text: string; tokensUsed: number }
  try {
    synth = await synthesize(question, kbContext, history, totalSources, requestsFile)
  } catch (err: any) {
    // Fallback: bullet list of raw KB summaries so user gets SOMETHING
    const fallback = totalSources > 0
      ? [
          ...emailResults.map(r     => `• ${r.entry.summary}`),
          ...attachmentResults.map(r => `• [${r.attachment.filename}] ${r.attachment.summary ?? ''}`),
        ].join('\n')
      : 'The knowledge base returned no results for this query. Try rephrasing or syncing the KB first.'
    synth = { text: fallback, tokensUsed: 0 }
  }

  // ── Safety check ──────────────────────────────────────────────────────────
  const safety      = checkResponseSafety(synth.text)
  const finalAnswer = safety.allowed ? synth.text : 'This response was blocked to protect team member privacy.'
  const respType    = requestsFile && safety.allowed ? 'document' : detectResponseType(finalAnswer)
  const clusters    = [...new Set(emailResults.map(r => r.entry.detected_project).filter(Boolean) as string[])]

  // ── Persist conversation + messages ───────────────────────────────────────
  let convId = conversationId
  if (!convId) {
    const { data: conv } = await supabase
      .from('agent_conversations')
      .insert({ member_id: member.id, title: question.slice(0, 70) })
      .select('id').single()
    convId = conv?.id
  } else {
    await supabase.from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId).eq('member_id', member.id)
  }

  let messageId: string | undefined
  if (convId) {
    await supabase.from('agent_messages').insert({
      conversation_id: convId, role: 'user', content: question,
    })
    const { data: aMsg } = await supabase.from('agent_messages')
      .insert({
        conversation_id:             convId,
        role:                        'assistant',
        content:                     finalAnswer,
        kb_entries_referenced:       totalSources,
        project_clusters_referenced: clusters,
        response_type:               respType,
        tokens_used:                 synth.tokensUsed,
        was_blocked:                 !safety.allowed,
        block_reason:                safety.allowed ? null : 'Personal topic detected in response',
      })
      .select('id').single()
    messageId = aMsg?.id
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  await logKBQuery(supabase, {
    queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id,
    wasBlocked: !safety.allowed, kbEntriesAccessed: totalSources,
    projectClustersHit: clusters, responseType: respType,
  })

  return NextResponse.json({
    answer: finalAnswer, wasBlocked: !safety.allowed,
    responseType: respType, projectClusters: clusters,
    kbEntriesUsed: totalSources, conversationId: convId,
    messageId, tokensUsed: synth.tokensUsed,
  })
}
