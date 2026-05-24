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

// ── Conversation history ──────────────────────────────────────────────────────
async function fetchHistory(supabase: SupabaseClient, convId: string): Promise<HistoryMsg[]> {
  const { data } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(14)
  return (data ?? []).filter(
    (m): m is HistoryMsg => m.role === 'user' || m.role === 'assistant',
  )
}

// ── Enriched search query for short/vague follow-ups ─────────────────────────
// When the query is short ("who owns it?", "and the deadline?"), we append
// the last exchange so the embedding search finds the right project context.
function buildSearchQuery(question: string, history: HistoryMsg[]): string {
  const wordCount = question.trim().split(/\s+/).length
  if (wordCount <= 6 && history.length >= 2) {
    const lastUser = [...history].reverse().find(m => m.role === 'user')
    const lastBot  = [...history].reverse().find(m => m.role === 'assistant')
    return [question, lastUser?.content?.slice(0, 150), lastBot?.content?.slice(0, 200)]
      .filter(Boolean).join(' ')
  }
  return question
}

// ── Ambiguity detection ───────────────────────────────────────────────────────
// Patterns where the user references "the client / the project / the issue"
// without naming it — these are only ambiguous when history has no context
// AND the KB returns results from multiple different projects.
const VAGUE_REFS = [
  /\bthe\s+(client|customer|vendor|partner)\b(?!\s+\w+ly)/i,
  /\bthe\s+(project|engagement|account|contract)\b(?!\s+\w+ly)/i,
  /\bthe\s+(issue|problem|bug|blocker|task|feature|module)\b/i,
  /\b(which|what)\s+(client|project|issue)\b/i,
  /^(what|how|who|when|why|any|tell me)\b.{0,30}$/i,  // very short, generic openers
]

function hasVagueReference(q: string): boolean {
  return VAGUE_REFS.some(p => p.test(q))
}

// Whether conversation history already resolves a vague reference
// (checks if any specific project/client name appears in recent history)
function historyResolvesContext(history: HistoryMsg[]): boolean {
  if (history.length === 0) return false
  const recent = history.slice(-4).map(m => m.content).join(' ')
  // If the last few messages contain a capitalised word (likely a proper noun = client/project name)
  return /\b[A-Z][a-z]{2,}\b/.test(recent)
}

// ── File export intent ────────────────────────────────────────────────────────
const FILE_RX = [
  /\b(export|download|generate|create|produce|give me)\b.{0,30}\b(report|excel|xlsx|csv|pdf|sheet|spreadsheet|document|file)\b/i,
  /\b(excel|xlsx|csv|pdf)\b.{0,20}\b(report|summary|list|data)\b/i,
]
const wantsFile = (t: string) => FILE_RX.some(p => p.test(t))

// ── Bedrock call wrapper ──────────────────────────────────────────────────────
async function callAI(
  messages:   Array<{ role: string; content: Array<{ text: string }> }>,
  systemText: string,
  maxTokens = 1400,
): Promise<{ text: string; tokensUsed: number }> {
  const body   = JSON.stringify({
    messages,
    system:          [{ text: systemText }],
    inferenceConfig: { maxTokens, temperature: 0.2 },
  })
  const resp   = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID, contentType: 'application/json',
    accept: 'application/json', body: Buffer.from(body),
  }))
  const parsed = JSON.parse(Buffer.from(resp.body).toString('utf-8'))
  return {
    text:       parsed.output?.message?.content?.[0]?.text?.trim() ?? '',
    tokensUsed: (parsed.usage?.inputTokens ?? 0) + (parsed.usage?.outputTokens ?? 0),
  }
}

// ── KB context builder ────────────────────────────────────────────────────────
function buildKBContext(
  emails:      KBSearchResult[],
  attachments: AttachmentSearchResult[],
): string {
  const emailPart = emails.map((r, i) => {
    const e = r.entry
    const actionStr = (e.action_items as any[] ?? [])
      .map((a: any) => `${a.owner_hint ?? 'Team'} → ${a.task}${a.due_date_hint ? ` (by ${a.due_date_hint})` : ''}`)
      .join(' | ')
    return [
      `[Email ${i + 1} | Project: ${e.detected_project ?? 'Unknown'} | Date: ${e.email_date ? new Date(e.email_date).toLocaleDateString('en-IN') : 'Unknown'}]`,
      `Summary: ${e.summary}`,
      e.key_points?.length   ? `Key facts: ${e.key_points.join(' • ')}` : null,
      actionStr              ? `Action items: ${actionStr}`              : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const docPart = attachments.map((r, i) => {
    const a = r.attachment
    return [
      `[Doc ${i + 1} | File: ${a.filename} | Project: ${(a as any).detected_project ?? 'Unknown'} | Date: ${a.email_date ? new Date(a.email_date).toLocaleDateString('en-IN') : 'Unknown'}]`,
      `Summary: ${a.summary ?? 'No summary'}`,
      a.key_points?.length ? `Key facts: ${a.key_points.join(' • ')}` : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  return [
    emailPart ? `=== PROJECT EMAILS ===\n${emailPart}` : null,
    docPart   ? `=== DOCUMENTS ===\n${docPart}`        : null,
  ].filter(Boolean).join('\n\n')
}

// ── Signal types passed to the AI ────────────────────────────────────────────
interface QuerySignals {
  isAmbiguous:     boolean
  ambiguousProjects: string[]    // project names found in KB results
  isLowConfidence: boolean
  maxSimilarity:   number
  requestsFile:    boolean
  hasHistory:      boolean
}

// ── AI synthesis ──────────────────────────────────────────────────────────────
async function synthesize(
  question:  string,
  kbContext: string,
  history:   HistoryMsg[],
  sources:   number,
  signals:   QuerySignals,
): Promise<{ text: string; tokensUsed: number }> {

  // ── Dynamic instruction blocks injected based on signals ──────────────────
  const disambiguationBlock = signals.isAmbiguous
    ? `\n=== DISAMBIGUATION REQUIRED ===
The query is generic and the knowledge base returned results from ${signals.ambiguousProjects.length} different projects: ${signals.ambiguousProjects.join(', ')}.
DO NOT attempt to answer. Instead, ask the user ONE specific clarifying question.
Example: "Are you asking about ${signals.ambiguousProjects[0]} or ${signals.ambiguousProjects[1] ?? 'another project'}?"
Keep the question short and natural.`
    : ''

  const confidenceBlock = signals.isLowConfidence && !signals.isAmbiguous
    ? `\n=== LOW CONFIDENCE MATCH ===
The knowledge base search returned weak matches (best relevance: ${Math.round(signals.maxSimilarity * 100)}%).
The KB data below may not directly answer the question.
State what you can confirm from the data and explicitly say "I don't have a confident answer on [specific aspect]" for anything unclear.`
    : ''

  const fileBlock = signals.requestsFile
    ? `\n=== FILE EXPORT MODE ===
Structure your response with ## headers, tables (| col | col |) for tabular data, and bullet lists.
Be thorough. Include all KB-supported details — this will be converted to a downloadable file.`
    : ''

  const system = `You are an intelligent project knowledge assistant for a software delivery team.
You answer questions using ONLY facts explicitly present in the KB data provided.

=== ANTI-HALLUCINATION RULES (highest priority) ===
- NEVER invent, infer, or extrapolate facts not present in the KB data.
- NEVER fill gaps with general knowledge or assumptions.
- If a fact is not in the KB, say exactly: "I don't have that in the knowledge base."
- You may only state what the KB data directly supports.
- When you cite a fact, you may optionally note the project name and date.
${disambiguationBlock}${confidenceBlock}${fileBlock}

=== INTENT UNDERSTANDING ===
- Understand natural language intent: "What's cooking with Infosys?" = Infosys project status.
- Resolve references ("that task", "them", "it") using CONVERSATION HISTORY.
- If ambiguous even with history, ask ONE specific clarifying question — never multiple.
- Short/colloquial queries are valid. Match them semantically to KB content.

=== RESPONSE FORMAT ===
- Simple fact → 1–3 sentences.
- Multiple items → bullet list; action items: owner → task → due date.
- No openers: "Certainly!", "Great question!", "Sure!".
- No closers: "Hope this helps!", "Feel free to ask!", "Let me know!".
- No filler: "In summary", "Overall", "Moving forward".
- If nothing relevant in KB → say so, then ask one question to refine the search.

=== SCOPE ===
Project and work information only. Redirect personal queries back to project topics.`

  const msgs: Array<{ role: string; content: Array<{ text: string }> }> = []

  for (const m of history.slice(-8)) {
    msgs.push({ role: m.role, content: [{ text: m.content }] })
  }

  const userText = sources > 0
    ? `Question: ${question}\n\nKB Data (${sources} sources, max relevance ${Math.round(signals.maxSimilarity * 100)}%):\n${kbContext}\n\nAnswer:`
    : `Question: ${question}\n\nKB Data: No matching entries found.\n\nAnswer:`

  msgs.push({ role: 'user', content: [{ text: userText }] })

  return callAI(msgs, system, signals.requestsFile ? 2200 : 1400)
}

// ── Response type detection ───────────────────────────────────────────────────
function detectResponseType(text: string): string {
  if (/\|.+\|.+\|/.test(text) && /---/.test(text)) return 'table'
  if (/^#{1,3}\s/m.test(text))                      return 'report'
  if (/\bQ[1-4]\s+20\d\d\b/i.test(text))           return 'timeline'
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
  const explicitFormat = body?.docFormat as string | undefined

  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 })
  if (question.length > 2000) return NextResponse.json({ error: 'Question too long' }, { status: 400 })

  const supabase = getServiceSupabase()

  // Mentioned member detection
  const { data: allMembers } = await supabase
    .from('team_members').select('id, name, role').eq('is_active', true)
  const mentioned = (allMembers ?? []).find(
    (m: any) => question.toLowerCase().includes(m.name.toLowerCase()),
  ) as { id: string; name: string; role: TeamRole } | undefined

  // Compliance check
  const access = checkKBAccess({ viewerRole: member.role, queryText: question, targetMemberRole: mentioned?.role })
  if (!access.allowed) {
    await logKBQuery(supabase, {
      queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id,
      wasBlocked: true, blockReason: access.blockReason ?? undefined,
      personalTopicsFound: access.personalTopicsFound,
    })
    return NextResponse.json({
      answer: 'That query touches on personal topics outside the scope of the project knowledge base.',
      wasBlocked: true, responseType: 'text', kbEntriesUsed: 0, projectClusters: [], tokensUsed: 0,
    })
  }

  // History + enriched search query
  const history     = conversationId ? await fetchHistory(supabase, conversationId) : []
  const searchQuery = buildSearchQuery(question, history)
  const requestsFile = !!(explicitFormat || wantsFile(question))

  // KB search
  const searchParams = {
    query: searchQuery, viewerRole: member.role, viewerMemberId: member.id,
    memberIds: mentioned ? [mentioned.id] : undefined,
  }
  const [emailResults, attachmentResults] = await Promise.all([
    searchKB(supabase,          { ...searchParams, limit: 12 }),
    searchAttachments(supabase, { ...searchParams, limit: 8  }),
  ])

  const totalSources  = emailResults.length + attachmentResults.length
  const allSimilarity = [
    ...emailResults.map(r => r.similarity),
    ...attachmentResults.map(r => r.similarity),
  ]
  const maxSimilarity = allSimilarity.length > 0 ? Math.max(...allSimilarity) : 0

  // Build signals for the AI
  const uniqueProjects = [...new Set(
    emailResults.map(r => r.entry.detected_project).filter((p): p is string => !!p),
  )]
  const queryIsVague   = hasVagueReference(question)
  const contextResolved = historyResolvesContext(history)
  const isAmbiguous    = queryIsVague && !contextResolved && uniqueProjects.length >= 2
  const isLowConfidence = totalSources > 0 && maxSimilarity < 0.38

  const signals: QuerySignals = {
    isAmbiguous,
    ambiguousProjects: uniqueProjects,
    isLowConfidence,
    maxSimilarity,
    requestsFile,
    hasHistory: history.length > 0,
  }

  const kbContext = totalSources > 0 ? buildKBContext(emailResults, attachmentResults) : ''

  // AI synthesis
  let synth: { text: string; tokensUsed: number }
  try {
    synth = await synthesize(question, kbContext, history, totalSources, signals)
  } catch {
    const fallback = totalSources > 0
      ? emailResults.map(r => `• [${r.entry.detected_project ?? 'Unknown'}] ${r.entry.summary}`).join('\n')
      : 'No matching information found. Try rephrasing or running a KB sync first.'
    synth = { text: fallback, tokensUsed: 0 }
  }

  // Safety + response type
  const safety      = checkResponseSafety(synth.text)
  const finalAnswer = safety.allowed ? synth.text : 'This response was blocked to protect team member privacy.'
  const respType    = requestsFile && safety.allowed ? 'document' : detectResponseType(finalAnswer)
  const clusters    = uniqueProjects

  // Persist conversation
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
        block_reason:                safety.allowed ? null : 'Personal topic in response',
      })
      .select('id').single()
    messageId = aMsg?.id
  }

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
