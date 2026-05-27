import { NextRequest, NextResponse }               from 'next/server'
import { getConsentedMember, getServiceSupabase }  from '@/lib/auth'
import { checkKBAccess, checkResponseSafety }      from '@/lib/compliance/access-guard'
import { logKBQuery }                              from '@/lib/compliance/audit-logger'
import { checkRateLimit }                          from '@/lib/rate-limit'
import { VISIBILITY_MAP }                          from '@/lib/roles'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import type { SupabaseClient }                     from '@supabase/supabase-js'
import type { KBSearchResult, AttachmentSearchResult } from '@/lib/supabase/types'
import type { TeamRole }                           from '@/lib/roles'
import {
  fetchAllProjectClusters,
  detectProjectInQuery,
  detectProjectInHistory,
  fetchProjectKBHybrid,
  fetchMultiProjectKB,
  buildProjectContext,
  buildMultiProjectContext,
  isSpecificQuery,
  type ProjectCluster,
} from '@/lib/kb/project-fetch'
import { searchAttachments }                       from '@/lib/kb/search'

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

// ── Resolve visible members for the viewer ────────────────────────────────────
async function resolveVisibleMembers(
  supabase:    SupabaseClient,
  viewerRole:  TeamRole,
): Promise<{ ids: string[]; map: Map<string, { name: string; role: string }> }> {
  const visibleRoles = VISIBILITY_MAP[viewerRole]
  const { data: members } = await supabase
    .from('team_members')
    .select('id, name, role')
    .in('role', visibleRoles)
    .eq('is_active', true)

  const list = members ?? []
  return {
    ids: list.map(m => m.id),
    map: new Map(list.map(m => [m.id, m])),
  }
}

// ── Aggregation query detection ───────────────────────────────────────────────
const AGGREGATION_PATTERNS = [
  /\b(blocker|blocking|blocked|stuck|halt)\b/i,
  /\b(action item|pending|outstanding|open task|follow.?up)\b/i,
  /\b(go.?live|deadline|launch date|delivery date|milestone|when.{0,10}due)\b/i,
  /\b(risk|concern|critical|urgent|warning|escalat)\b/i,
  /\b(status|progress|update).{0,20}\b(all|team|project|overall|across)\b/i,
  /\b(summary|overview|recap).{0,20}\b(all|project|everything|team)\b/i,
]
const isAggregationQuery = (q: string) => AGGREGATION_PATTERNS.some(p => p.test(q))

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
  maxTokens = 1800,
): Promise<{ text: string; tokensUsed: number }> {
  const body   = JSON.stringify({
    messages,
    system:          [{ text: systemText }],
    inferenceConfig: { maxTokens, temperature: 0.15 },
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

// ── Response type detection ───────────────────────────────────────────────────
function detectResponseType(text: string): string {
  if (/\|.+\|.+\|/.test(text) && /---/.test(text)) return 'table'
  if (/^#{1,3}\s/m.test(text))                      return 'report'
  if (/\bQ[1-4]\s+20\d\d\b/i.test(text))           return 'timeline'
  return 'text'
}

// ── AI Synthesis — project-aware ──────────────────────────────────────────────
async function synthesize(params: {
  question:     string
  kbContext:    string
  history:      HistoryMsg[]
  projectNames: string[]
  strategy:     string
  requestsFile: boolean
  entryCount:   number
}): Promise<{ text: string; tokensUsed: number }> {

  const fileBlock = params.requestsFile
    ? `\n=== FILE EXPORT MODE ===
Structure your response with ## headers, tables (| col | col |) for tabular data, and bullet lists.
Be thorough. Include all KB-supported details — this will be converted to a downloadable file.`
    : ''

  const projectScope = params.projectNames.length === 1
    ? `You are currently answering questions about the "${params.projectNames[0]}" project knowledge base.`
    : params.projectNames.length > 1
      ? `You have access to ${params.projectNames.length} project knowledge bases: ${params.projectNames.join(', ')}.`
      : 'You have access to the full project knowledge base.'

  const system = `You are an intelligent project knowledge assistant for a software delivery team.
You answer questions using ONLY facts explicitly present in the KB data provided below.
${projectScope}

=== ANTI-HALLUCINATION RULES (highest priority) ===
- NEVER invent, infer, or extrapolate facts not present in the KB data.
- NEVER fill gaps with general knowledge or assumptions.
- If a fact is not in the KB data, say exactly: "I don't have that in the knowledge base."
- You may only state what the KB data directly supports.
- When you cite a fact, mention the project name and approximate date.

=== INTENT UNDERSTANDING ===
- Understand natural language intent: "What's cooking with Infosys?" = Infosys project status.
- Resolve references ("that task", "them", "it") using CONVERSATION HISTORY.
- Short/colloquial queries are valid. Match them semantically to KB content.
- You have been given ${params.entryCount} KB entries using strategy: ${params.strategy}.

=== RESPONSE FORMAT ===
- Simple fact → 1–3 sentences.
- Multiple items → bullet list; action items: owner → task → due date.
- Multi-project overview → group by project name as ## headers.
- No openers: "Certainly!", "Great question!", "Sure!".
- No closers: "Hope this helps!", "Feel free to ask!", "Let me know!".
- No filler: "In summary", "Overall", "Moving forward".
- If nothing relevant in KB → state clearly and ask ONE specific clarifying question.

=== SCOPE ===
Project and work information only. Redirect personal queries back to project topics.${fileBlock}`

  const msgs: Array<{ role: string; content: Array<{ text: string }> }> = []

  for (const m of params.history.slice(-8)) {
    msgs.push({ role: m.role, content: [{ text: m.content }] })
  }

  const userText = params.entryCount > 0
    ? `Question: ${params.question}\n\nKB Data (${params.entryCount} entries from ${params.projectNames.join(', ') || 'all projects'}):\n${params.kbContext}\n\nAnswer:`
    : `Question: ${params.question}\n\nKB Data: No matching entries found.\n\nAnswer:`

  msgs.push({ role: 'user', content: [{ text: userText }] })

  return callAI(msgs, system, params.requestsFile ? 2800 : 1800)
}

// ── Smart clarifying question generator ──────────────────────────────────────
// The AI asks a well-formed clarifying question when it can't confidently
// determine which project the user is asking about.
// Only fires when BOTH conditions are true:
//   1. Query is ambiguous (no project detected in query OR history)
//   2. Multiple projects exist in the KB (otherwise there's no ambiguity)

function buildClarifyingQuestionResponse(
  question:         string,
  availableClusters: ProjectCluster[],
  history:           HistoryMsg[],
): string {
  const projectList = availableClusters
    .slice(0, 8)   // cap at 8 so the question stays concise
    .map(c => `• **${c.name}** (${c.entryCount} email${c.entryCount !== 1 ? 's' : ''})`)
    .join('\n')

  // Tailor the question based on what the user asked
  const qLower    = question.toLowerCase()
  const wantsWhat = qLower.includes('status')   ? 'status'
    : qLower.includes('action') || qLower.includes('task') ? 'action items'
    : qLower.includes('risk')   || qLower.includes('blocker') ? 'risks/blockers'
    : qLower.includes('update')                  ? 'updates'
    : 'information'

  const hasHistory = history.length > 0
  const prefix     = hasHistory
    ? 'I want to make sure I pull from the right project knowledge base.'
    : "I can see you're asking about project " + wantsWhat + '.'

  return `${prefix} Which project are you referring to?\n\n${projectList}\n\nJust mention the project name (or part of it) and I'll fetch the full knowledge base for it.`
}

// ── Decide whether to ask a clarifying question ───────────────────────────────
// Returns true ONLY when asking is genuinely necessary.
// Goal: Never ask when context is clear. Only ask when truly ambiguous.

function shouldAskClarifyingQuestion(
  question:         string,
  detectedProject:  ProjectCluster | null,
  availableClusters: ProjectCluster[],
  history:           HistoryMsg[],
  isAggregation:     boolean,
): boolean {
  // Never ask for aggregation queries (they span all projects by design)
  if (isAggregation) return false

  // Never ask if we already detected a project
  if (detectedProject) return false

  // Never ask if only 0–1 projects exist (no ambiguity)
  if (availableClusters.length <= 1) return false

  // Never ask if the KB is empty (just say "no data found")
  if (availableClusters.every(c => c.entryCount === 0)) return false

  // Never ask for very short follow-up queries in an active conversation
  // (they're almost certainly following up on the previous answer's project)
  const wordCount = question.trim().split(/\s+/).length
  if (wordCount <= 5 && history.length >= 2) return false

  // Never ask for casual factual lookups that don't need project scoping
  const SELF_SCOPING = [
    /\bwhat (projects|clients|accounts) (do we have|are there|exist)/i,
    /\blist (all |the |my )?(projects|clients|accounts)/i,
    /\bhow many (projects|clients)/i,
  ]
  if (SELF_SCOPING.some(p => p.test(question))) return false

  // Ask only when:
  //   - Multiple projects exist (≥2)
  //   - No project detected from query or history
  //   - Query is substantive (not a very short follow-up)
  return true
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
  const hintClusterId  = body?.projectClusterId as string | undefined   // sent when user clicks a project chip

  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 })
  if (question.length > 2000) return NextResponse.json({ error: 'Question too long' }, { status: 400 })

  const supabase = getServiceSupabase()

  // ── Compliance check ────────────────────────────────────────────────────────
  const { data: allMembers } = await supabase
    .from('team_members').select('id, name, role').eq('is_active', true)
  const mentioned = (allMembers ?? []).find(
    (m: any) => question.toLowerCase().includes(m.name.toLowerCase()),
  ) as { id: string; name: string; role: TeamRole } | undefined

  const access = checkKBAccess({ viewerRole: member.role, queryText: question, targetMemberRole: mentioned?.role })
  if (!access.allowed) {
    await logKBQuery(supabase, {
      queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id,
      wasBlocked: true, blockReason: access.blockReason ?? undefined,
      personalTopicsFound: access.personalTopicsFound,
    })
    return NextResponse.json({
      answer: '🚫 Compliance Violation: This query touches on personal or sensitive topics that are outside the scope of the project knowledge base. This attempt has been logged for compliance auditing.',
      wasBlocked: true, responseType: 'text', kbEntriesUsed: 0, projectClusters: [],
      projectClusterDetails: [], tokensUsed: 0,
    })
  }

  // ── Load history + visible members + all project clusters ───────────────────
  const [history, { ids: memberIds, map: memberMap }, availableClusters] = await Promise.all([
    conversationId ? fetchHistory(supabase, conversationId) : Promise.resolve([] as HistoryMsg[]),
    resolveVisibleMembers(supabase, member.role as TeamRole),
    fetchAllProjectClusters(supabase, member.role as TeamRole, member.id),
  ])

  if (!memberIds.length) {
    return NextResponse.json({
      answer: 'No team member data found. Please check that your account is active and has proper role assignments.',
      wasBlocked: false, responseType: 'text', kbEntriesUsed: 0, projectClusters: [],
      projectClusterDetails: [], tokensUsed: 0,
    })
  }

  const requestsFile  = !!(explicitFormat || wantsFile(question))
  const isAggregation = isAggregationQuery(question)
  const isSpecific    = isSpecificQuery(question)

  // ── Project detection (query → history → hint from UI → null) ──────────────
  let detectedProject: ProjectCluster | null = null

  // 1. If frontend sends an explicit cluster ID (user clicked a project chip)
  if (hintClusterId) {
    detectedProject = availableClusters.find(c => c.id === hintClusterId) ?? null
  }

  // 2. Try to detect from the query text itself
  if (!detectedProject) {
    detectedProject = detectProjectInQuery(question, availableClusters)
  }

  // 3. Try to resolve from conversation history
  if (!detectedProject && history.length > 0) {
    detectedProject = detectProjectInHistory(history, availableClusters)
  }

  // ── Decision: Ask clarifying question? ─────────────────────────────────────
  const needsClarification = shouldAskClarifyingQuestion(
    question,
    detectedProject,
    availableClusters,
    history,
    isAggregation,
  )

  if (needsClarification) {
    const clarifyingAnswer = buildClarifyingQuestionResponse(question, availableClusters, history)

    // Persist conversation
    let convId = conversationId
    if (!convId) {
      const { data: conv } = await supabase
        .from('agent_conversations')
        .insert({ member_id: member.id, title: question.slice(0, 70) })
        .select('id').single()
      convId = conv?.id
    }

    if (convId) {
      await supabase.from('agent_messages').insert({ conversation_id: convId, role: 'user', content: question })
      await supabase.from('agent_messages').insert({
        conversation_id:             convId,
        role:                        'assistant',
        content:                     clarifyingAnswer,
        kb_entries_referenced:       0,
        project_clusters_referenced: [],
        response_type:               'clarifying_question',
        tokens_used:                 0,
        was_blocked:                 false,
      })
    }

    await logKBQuery(supabase, {
      queriedBy: member.id, queryText: question, wasBlocked: false,
      kbEntriesAccessed: 0, responseType: 'clarifying_question',
    })

    return NextResponse.json({
      answer:               clarifyingAnswer,
      wasBlocked:           false,
      responseType:         'clarifying_question',
      projectClusters:      [],
      projectClusterDetails: availableClusters.slice(0, 8).map(c => ({ id: c.id, name: c.name, entryCount: c.entryCount })),
      kbEntriesUsed:        0,
      conversationId:       convId,
      tokensUsed:           0,
      isClarifyingQuestion: true,
    })
  }

  // ── KB fetch strategy ───────────────────────────────────────────────────────
  let kbContext      = ''
  let projectNames:  string[] = []
  let totalEntries   = 0
  let strategy       = 'none'
  let attachResults: AttachmentSearchResult[] = []

  if (isAggregation && !detectedProject) {
    // Cross-project aggregation: fetch recent entries from ALL projects grouped
    const grouped = await fetchMultiProjectKB(supabase, memberIds, memberMap)
    kbContext    = buildMultiProjectContext(grouped)
    projectNames = [...grouped.keys()]
    totalEntries = [...grouped.values()].reduce((s, a) => s + a.length, 0)
    strategy     = 'multi_project_aggregation'
  } else if (detectedProject) {
    // Single-project fetch with Option C hybrid strategy
    const fetch = await fetchProjectKBHybrid(
      supabase,
      detectedProject.id,
      memberIds,
      question,
      memberMap,
      isSpecific,
    )
    kbContext    = buildProjectContext(fetch.results, detectedProject.name, fetch.strategy)
    projectNames = [detectedProject.name]
    totalEntries = fetch.results.length
    strategy     = fetch.strategy

    // Also fetch attachments for this project
    try {
      attachResults = await searchAttachments(supabase, {
        query:            question,
        viewerRole:       member.role as TeamRole,
        viewerMemberId:   member.id,
        projectClusterId: detectedProject.id,
        limit:            6,
      })
      if (attachResults.length) {
        const docSection = attachResults.map((r, i) => {
          const a = r.attachment
          return [
            `[Doc ${i + 1} | File: ${a.filename} | Date: ${a.email_date ? new Date(a.email_date).toLocaleDateString('en-IN') : 'Unknown'}]`,
            `Summary: ${a.summary ?? 'No summary'}`,
            a.key_points?.length ? `Key facts: ${a.key_points.join(' • ')}` : null,
          ].filter(Boolean).join('\n')
        }).join('\n\n')
        kbContext += `\n\n=== DOCUMENTS & ATTACHMENTS ===\n${docSection}`
        totalEntries += attachResults.length
      }
    } catch { /* attachment search failure is non-critical */ }

  } else if (availableClusters.length === 1) {
    // Only one project exists — use it automatically, no need to ask
    const onlyCluster = availableClusters[0]
    const fetch = await fetchProjectKBHybrid(
      supabase,
      onlyCluster.id,
      memberIds,
      question,
      memberMap,
      isSpecific,
    )
    kbContext    = buildProjectContext(fetch.results, onlyCluster.name, fetch.strategy)
    projectNames = [onlyCluster.name]
    totalEntries = fetch.results.length
    strategy     = fetch.strategy
  } else {
    // No project detected, no aggregation, no single project — do broad recent scan
    const { data: recentEntries } = await supabase
      .from('email_knowledge_base')
      .select('*')
      .in('owner_member_id', memberIds)
      .order('email_date', { ascending: false })
      .limit(20)

    if (recentEntries?.length) {
      const grouped = new Map<string, KBSearchResult[]>()
      for (const entry of recentEntries as any[]) {
        const p = entry.detected_project ?? 'Unknown'
        if (!grouped.has(p)) grouped.set(p, [])
        grouped.get(p)!.push({
          entry, similarity: 0.6,
          memberName: (memberMap.get(entry.owner_member_id) as any)?.name ?? 'Unknown',
          memberRole: ((memberMap.get(entry.owner_member_id) as any)?.role ?? 'developer') as TeamRole,
        })
      }
      kbContext    = buildMultiProjectContext(grouped)
      projectNames = [...grouped.keys()]
      totalEntries = recentEntries.length
      strategy     = 'broad_recent'
    }
  }

  // ── AI synthesis ────────────────────────────────────────────────────────────
  let synth: { text: string; tokensUsed: number }
  try {
    synth = await synthesize({
      question,
      kbContext,
      history,
      projectNames,
      strategy,
      requestsFile,
      entryCount: totalEntries,
    })
  } catch {
    const fallback = totalEntries > 0
      ? `Based on ${totalEntries} KB entries for ${projectNames.join(', ')}, I encountered a processing error. Please try again.`
      : 'No matching information found. Try rephrasing or running a KB sync first.'
    synth = { text: fallback, tokensUsed: 0 }
  }

  // ── Safety check ────────────────────────────────────────────────────────────
  const safety      = checkResponseSafety(synth.text)
  const finalAnswer = safety.allowed ? synth.text : 'This response was blocked to protect team member privacy.'
  const respType    = requestsFile && safety.allowed ? 'document' : detectResponseType(finalAnswer)

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

  // ── Persist conversation ─────────────────────────────────────────────────────
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
        kb_entries_referenced:       totalEntries,
        project_clusters_referenced: projectNames,
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
    wasBlocked: !safety.allowed, kbEntriesAccessed: totalEntries,
    projectClustersHit: projectNames, responseType: respType,
  })

  return NextResponse.json({
    answer:               finalAnswer,
    wasBlocked:           !safety.allowed,
    responseType:         respType,
    projectClusters:      projectNames,
    projectClusterDetails: availableClusters.slice(0, 8).map(c => ({
      id: c.id, name: c.name, entryCount: c.entryCount,
    })),
    kbEntriesUsed:        totalEntries,
    kbStrategy:           strategy,
    conversationId:       convId,
    messageId,
    tokensUsed:           synth.tokensUsed,
    documentFilename:     requestsFile && safety.allowed ? documentFilename : undefined,
    isClarifyingQuestion: false,
  })
}
