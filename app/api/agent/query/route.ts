import { NextRequest, NextResponse }               from 'next/server'
import { getConsentedMember, getServiceSupabase }  from '@/lib/auth'
import { searchKB, searchAttachments }             from '@/lib/kb/search'
import { checkKBAccess, checkResponseSafety }      from '@/lib/compliance/access-guard'
import { logKBQuery }                              from '@/lib/compliance/audit-logger'
import { checkRateLimit }                          from '@/lib/rate-limit'
import { VISIBILITY_MAP }                          from '@/lib/roles'
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

// ── Semantic intent expansion ─────────────────────────────────────────────────
// Expands work-related keywords so the embedding search finds related entries
// that use different wording (e.g. "CRITICAL" instead of "blocker").
const INTENT_EXPANSIONS: Array<[RegExp, string]> = [
  [/\b(blocker|blocking|blocked|stuck)\b/i,       'blocker critical urgent problem halted unable'],
  [/\b(risk|risky|concern|warning)\b/i,            'risk concern warning danger mitigation challenge'],
  [/\b(issue|problem|bug|defect|error)\b/i,        'issue problem defect error failure critical'],
  [/\b(status|progress|update|how.{0,10}going)\b/i, 'status progress update milestone current state'],
  [/\b(deadline|go.live|launch|delivery|due)\b/i,  'deadline go-live launch delivery date target approval'],
  [/\b(action item|pending|outstanding|todo)\b/i,  'action item pending outstanding task owner due date'],
  [/\b(decision|decided|agreed|approved)\b/i,      'decision decided agreed approved confirmed sign-off'],
]

function expandQueryIntent(q: string): string {
  for (const [pattern, expansion] of INTENT_EXPANSIONS) {
    if (pattern.test(q)) return `${q} ${expansion}`
  }
  return q
}

// ── Enriched search query for short/vague follow-ups ─────────────────────────
// When the query is short ("who owns it?", "and the deadline?"), we append
// the last exchange so the embedding search finds the right project context.
function buildSearchQuery(question: string, history: HistoryMsg[]): string {
  let q = expandQueryIntent(question)
  const wordCount = question.trim().split(/\s+/).length
  if (wordCount <= 6 && history.length >= 2) {
    const lastUser = [...history].reverse().find(m => m.role === 'user')
    const lastBot  = [...history].reverse().find(m => m.role === 'assistant')
    q = [q, lastUser?.content?.slice(0, 150), lastBot?.content?.slice(0, 200)]
      .filter(Boolean).join(' ')
  }
  return q
}

// ── Aggregation query detection ───────────────────────────────────────────────
// Queries that want information across ALL projects — "blockers", "action items",
// "go-live dates", "risks". For these, vector search is unreliable because each
// project may use different words for the same concept (e.g. "CRITICAL" vs "blocker").
// We instead do a broad date-sorted fetch so every project is represented.
const AGGREGATION_PATTERNS = [
  /\b(blocker|blocking|blocked|stuck|halt)\b/i,
  /\b(action item|pending|outstanding|open task|follow.?up)\b/i,
  /\b(go.?live|deadline|launch date|delivery date|milestone|when.{0,10}due)\b/i,
  /\b(risk|concern|critical|urgent|warning|escalat)\b/i,
  /\b(status|progress|update).{0,20}\b(all|team|project|overall|across)\b/i,
  /\b(summary|overview|recap).{0,20}\b(all|project|everything|team)\b/i,
]

function isAggregationQuery(q: string): boolean {
  return AGGREGATION_PATTERNS.some(p => p.test(q))
}

// ── Broad KB scan ─────────────────────────────────────────────────────────────
// Fetches recent entries across ALL visible projects without vector ranking.
// Used when the query asks for information that spans multiple projects.
async function broadScanKB(
  supabase: SupabaseClient,
  viewerRole: TeamRole,
  limit: number,
): Promise<KBSearchResult[]> {
  const visibleRoles = VISIBILITY_MAP[viewerRole]
  const { data: visMembers } = await supabase
    .from('team_members')
    .select('id, name, role')
    .in('role', visibleRoles)
    .eq('is_active', true)

  if (!visMembers?.length) return []
  const visIds = visMembers.map((m: { id: string }) => m.id)

  const { data: entries } = await supabase
    .from('email_knowledge_base')
    .select('*')
    .in('owner_member_id', visIds)
    .order('email_date', { ascending: false })
    .limit(limit)

  const memberMap = new Map(visMembers.map((m: { id: string; name: string; role: string }) => [m.id, m]))

  return (entries ?? []).map((entry: any) => ({
    entry,
    similarity: 0.75,
    memberName: (memberMap.get(entry.owner_member_id) as any)?.name ?? 'Unknown',
    memberRole: ((memberMap.get(entry.owner_member_id) as any)?.role ?? 'developer') as TeamRole,
  }))
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

// Whether conversation history already resolves a vague reference.
// Only checks the USER's own messages — the assistant's answers are full of proper
// nouns (project names it just mentioned) which would falsely suppress disambiguation.
function historyResolvesContext(history: HistoryMsg[]): boolean {
  if (history.length === 0) return false
  const recentUserText = history.slice(-6)
    .filter(m => m.role === 'user')
    .map(m => m.content).join(' ')
  // 5+ char capitalised word = likely a specific project / client name typed by the user
  return /\b[A-Z][a-zA-Z]{4,}\b/.test(recentUserText)
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
The knowledge base search returned very weak matches (best relevance: ${Math.round(signals.maxSimilarity * 100)}%).
DO NOT guess, assume, or generate a random or weak response. Instead, state clearly that you cannot find a confident match for their query, and ask the user a specific, helpful clarifying question (e.g. asking which project, topic, or sender they are referring to) to help narrow it down.`
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
- If nothing relevant in KB → state clearly that you cannot find any matching records in the project knowledge base, and ask the user a clarifying question to refine the search.

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
      answer: '🚫 Compliance Violation: This query touches on personal or sensitive topics that are outside the scope of the project knowledge base. This attempt has been logged for compliance auditing.',
      wasBlocked: true, responseType: 'text', kbEntriesUsed: 0, projectClusters: [], tokensUsed: 0,
    })
  }

  // History + intent signals (computed before search so they can influence strategy)
  const history         = conversationId ? await fetchHistory(supabase, conversationId) : []
  const searchQuery     = buildSearchQuery(question, history)
  const requestsFile    = !!(explicitFormat || wantsFile(question))
  const queryIsVague    = hasVagueReference(question)
  const contextResolved = historyResolvesContext(history)

  // Cross-project aggregation queries ("blockers", "action items", "go-live dates")
  // bypass vector search and scan all recent KB entries so no project gets missed.
  const wantsBroadScan = isAggregationQuery(question) && !contextResolved

  // KB search
  const searchParams = {
    query: searchQuery, viewerRole: member.role, viewerMemberId: member.id,
    memberIds: mentioned ? [mentioned.id] : undefined,
  }
  const [emailResults, attachmentResults] = await Promise.all([
    wantsBroadScan
      ? broadScanKB(supabase, member.role as TeamRole, 18)
      : searchKB(supabase, { ...searchParams, limit: 12 }),
    searchAttachments(supabase, { ...searchParams, limit: 8 }),
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

  // For vague queries with no history context, check KB-wide project diversity —
  // the vector search may have returned only 1 project even though multiple exist,
  // simply because one project's content is semantically closer to the query.
  let kbProjectNames = uniqueProjects
  if (queryIsVague && !contextResolved) {
    const visibleRoles = VISIBILITY_MAP[member.role as TeamRole]
    const { data: visMembers } = await supabase
      .from('team_members').select('id').in('role', visibleRoles).eq('is_active', true)
    const visIds = (visMembers ?? []).map((m: { id: string }) => m.id)
    if (visIds.length > 0) {
      const { data: kbRows } = await supabase
        .from('email_knowledge_base')
        .select('detected_project')
        .in('owner_member_id', visIds)
        .not('detected_project', 'is', null)
      kbProjectNames = [...new Set(
        (kbRows ?? []).map((r: { detected_project: string }) => r.detected_project).filter(Boolean)
      )] as string[]
    }
  }

  const isAmbiguous    = queryIsVague && !contextResolved && kbProjectNames.length >= 2
  const isLowConfidence = totalSources > 0 && maxSimilarity < 0.38

  const signals: QuerySignals = {
    isAmbiguous,
    ambiguousProjects: kbProjectNames.slice(0, 5),   // cap at 5 to keep AI prompt concise
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

  let fileFormat: 'xlsx' | 'csv' | 'pdf' = 'xlsx'
  if (explicitFormat === 'csv' || explicitFormat === 'xlsx' || explicitFormat === 'pdf') {
    fileFormat = explicitFormat as any
  } else {
    const qLower = question.toLowerCase()
    if (qLower.includes('csv')) fileFormat = 'csv'
    else if (qLower.includes('pdf')) fileFormat = 'pdf'
  }
  const documentFilename = `project_report_${Date.now()}.${fileFormat}`
  const documentMime = fileFormat === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : fileFormat === 'pdf'
      ? 'application/pdf'
      : 'text/csv'

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
        document_filename:           requestsFile && safety.allowed ? documentFilename : null,
        document_mime_type:          requestsFile && safety.allowed ? documentMime : null,
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
    documentFilename: requestsFile && safety.allowed ? documentFilename : undefined,
  })
}
