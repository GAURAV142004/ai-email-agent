import { NextRequest, NextResponse, after }         from 'next/server'
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
import { getSemanticCache, setSemanticCache }       from '@/lib/kb/cache-service'
import { runKBSync }                               from '@/lib/kb/run-sync'

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

// ── Obvious personal-question pre-filter ─────────────────────────────────────
// Catches the most blatant personal queries before any KB lookup or AI call.
const OBVIOUS_PERSONAL_RX = [
  // Financial / compensation
  /\b(salary|ctc|cost.?to.?company|compensation|stipend|take.?home|remuneration|pay.?slip|payroll|bonus|hike|appraisal|increment)\b/i,
  /\bwhat\s+(does|did|is|was)\b.{0,30}\b(earn|make|paid|getting|drawing|taking home)\b/i,
  /\bhow much\s+(does|did|is|was)\b.{0,30}\b(earn|make|paid|get paid|drawing)\b/i,
  // Age / demographics
  /\bhow old\s+(is|was|are)\b/i,
  /\bwhat.*\b(his|her|their)\s+age\b/i,
  /\b(date of birth|dob|born on|year of birth)\b/i,
  // Address / location (personal)
  /\bwhere\s+(does|do|did|is|was)\b.{0,30}\b(live|stay|reside|based|located|stay at)\b/i,
  /\b(home address|residential address|personal address|house address|current address)\b/i,
  // Relationships / family
  /\b(his|her|their)\s+(family|kids|children|wife|husband|girlfriend|boyfriend|parents|siblings|spouse|partner|son|daughter)\b/i,
  /\b(does|did)\s+\w+\s+(have|has)\s+(kids|children|a wife|a husband|siblings|a partner|a girlfriend|a boyfriend)\b/i,
  /\b(married|single|divorced|separated|widowed|engaged|in a relationship)\b.{0,20}\b(is|was|are|were)\b/i,
  // Lifestyle / personal traits
  /\b(hobbies|personal interests|lifestyle|habits|passions|habits)\b.{0,30}\b(of|his|her|their)\b/i,
  /\b(his|her|their)\s+(hobbies|interests|lifestyle|habits|passions|personality|character|attitude)\b/i,
  /\btell me (something )?(personal|private) about\b/i,
  /\bwhat (do you know|can you tell me|is there) about\s+(him|her|them)\b/i,
  // Religion / identity
  /\bwhat\s+(religion|caste|community|faith|sect|denomination|political view)\b/i,
  /\b(his|her|their)\s+(religion|caste|community|faith|political|nationality|ethnicity|race)\b/i,
  // Health / medical
  /\b(health|medical|illness|disease|diagnosis|medication|treatment|therapy|doctor|hospital|surgery|disability)\b.{0,20}\b(of|his|her|their|about)\b/i,
  /\b(his|her|their)\s+(health|medical condition|mental health|illness|sick|doctor visit)\b/i,
  // Personal opinions / attitudes
  /\bwhat does\s+\w+\s+think (about|of)\b.{0,40}\b(personally|his opinion|her opinion)\b/i,
  /\b(his|her|their)\s+(opinion|view|stance|perspective|attitude|feelings?)\s+(on|about|towards)\b.{0,30}\b(personally|life|politics|religion)\b/i,
]
const isObviousPersonalQuery = (t: string) => OBVIOUS_PERSONAL_RX.some(p => p.test(t))

// ── AI-based personal query classifier (secondary check) ─────────────────────
// Fires only when the regex pre-filter doesn't catch something, but the
// question still looks like it might be personal based on keyword heuristics.
const PERSONAL_KEYWORD_HINTS = [
  /\b(personal|private|confidential|sensitive)\b/i,
  /\b(his|her|their|about him|about her)\b/i,
  /\b(character|personality|attitude|behavior|conduct|manner)\b/i,
  /\b(opinion|belief|view|stance|feeling|emotion)\b/i,
]
const mightBePersonal = (t: string) => PERSONAL_KEYWORD_HINTS.some(p => p.test(t))

// Classify using AI when regex hints suggest personal intent but aren't definitive
async function aiClassifyPersonal(question: string): Promise<boolean> {
  try {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: [{ text:
        `Is this question asking for personal/private information about an individual (e.g. their personal life, health, family, salary, religion, personal opinions unrelated to work)? Answer ONLY "yes" or "no".\n\nQuestion: "${question.slice(0, 400)}"` }] }],
      system: [{ text: 'You are a classifier. Answer ONLY "yes" or "no". No explanation.' }],
      inferenceConfig: { maxTokens: 5, temperature: 0 },
    })
    const resp = await bedrock.send(new InvokeModelCommand({
      modelId: MODEL_ID, contentType: 'application/json',
      accept: 'application/json', body: Buffer.from(body),
    }))
    const parsed = JSON.parse(Buffer.from(resp.body).toString('utf-8'))
    const answer = parsed.output?.message?.content?.[0]?.text?.trim().toLowerCase() ?? ''
    return answer.startsWith('yes')
  } catch {
    return false
  }
}

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

=== QUERY ANALYSIS — CRITICAL ===
Before answering, analyze the user's question:
1. Is this a single focused question or multiple questions mixed together?
2. If the question is about ONE specific aspect (e.g., "what is the status of X"), answer ONLY that.
3. If the question appears to span multiple UNRELATED topics or projects, DO NOT merge all answers.
   Instead, respond: "Your question seems to cover multiple topics. Could you clarify which specific
   aspect you'd like me to focus on first?" and list the topics you detected.
4. NEVER combine responses for different projects without clearly labeling each section.

=== INTENT UNDERSTANDING ===
- Understand natural language intent: "What's cooking with Infosys?" = Infosys project status.
- Resolve references ("that task", "them", "it") using CONVERSATION HISTORY.
- Short/colloquial queries are valid. Match them semantically to KB content.
- You have been given ${params.entryCount} KB entries using strategy: ${params.strategy}.

=== RESPONSE FORMAT ===
- Simple fact → 1–3 sentences.
- Multiple items → bullet list; action items: owner → task → due date.
- Multi-project overview → group by project name as ## headers (NEVER mix them).
- No openers: "Certainly!", "Great question!", "Sure!".
- No closers: "Hope this helps!", "Feel free to ask!", "Let me know!".
- No filler: "In summary", "Overall", "Moving forward".
- If nothing relevant in KB → state clearly and ask ONE specific clarifying question.

=== SCOPE — HARD RULES (non-negotiable) ===
You ONLY answer questions about project work: tasks, deadlines, decisions, blockers,
status updates, deliverables, meeting notes, and technical discussions.

You MUST REFUSE — with no exceptions — any question that is personal in nature,
including but not limited to:
  • Salary, CTC, compensation, earnings, or pay of any team member
  • Age, date of birth, or personal demographics
  • Home address, city, location, or where someone lives
  • Health, illness, medical leave, or personal absence reasons
  • Relationships (married/single/divorced/dating/family)
  • Hobbies, lifestyle, personal interests, or habits
  • Religion, caste, community, or faith
  • Personal opinions, beliefs, or attitudes unrelated to project work
  • Any private or personal attribute of a team member

When a personal question is detected, respond with EXACTLY this message and nothing else:
"⚠️ This question asks for personal information about a team member, which is outside the scope of this system. I only assist with project-related queries — tasks, deadlines, decisions, and work deliverables."

Do NOT say "I don't have that in the knowledge base" for personal questions — that
implies the data might exist. Use the exact refusal text above instead.${fileBlock}`

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
function buildClarifyingQuestionResponse(
  question:         string,
  availableClusters: ProjectCluster[],
  history:           HistoryMsg[],
): string {
  const projectList = availableClusters
    .slice(0, 8)
    .map(c => `• **${c.name}** (${c.entryCount} email${c.entryCount !== 1 ? 's' : ''} in KB)`)
    .join('\n')

  const qLower    = question.toLowerCase()
  const wantsWhat = qLower.includes('status')   ? 'status'
    : qLower.includes('action') || qLower.includes('task') ? 'action items'
    : qLower.includes('risk')   || qLower.includes('blocker') ? 'risks/blockers'
    : qLower.includes('update')                  ? 'updates'
    : qLower.includes('deadline') || qLower.includes('due') ? 'deadlines'
    : qLower.includes('client')                  ? 'client communication'
    : qLower.includes('decision')                ? 'decisions'
    : 'information'

  const hasHistory = history.length > 0
  const prefix     = hasHistory
    ? 'To give you the most accurate answer, I need to know which project you\'re asking about.'
    : `I can see you\'re asking about project **${wantsWhat}**.`

  return `${prefix} Which project are you referring to?\n\n${projectList}\n\nJust click the project name below, or type it and I'll pull the relevant knowledge base.`
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

  // ── Fix 4: Obvious personal-question pre-filter ─────────────────────────────
  if (isObviousPersonalQuery(question)) {
    const supabaseEarly = getServiceSupabase()
    await logKBQuery(supabaseEarly, {
      queriedBy: member.id,
      queryText: question,
      wasBlocked: true,
      blockReason: 'obvious_personal_query_pre_filter',
      personalTopicsFound: ['obvious_personal_intent'],
    })
    return NextResponse.json({
      answer: '🚫 **Out of Scope — Personal Query Detected**\n\nThis question asks for personal information about a team member (such as salary, location, age, relationships, hobbies, health, or religion). Personal attributes are strictly outside the scope of the project knowledge base.\n\nI can help you with:\n• Project status and progress\n• Action items and deadlines\n• Client communications and decisions\n• Blockers and risks\n• Team deliverables\n\nThis query has been logged for compliance auditing.',
      wasBlocked: true,
      responseType: 'text',
      kbEntriesUsed: 0,
      projectClusters: [],
      projectClusterDetails: [],
      tokensUsed: 0,
    })
  }

  // ── Secondary personal check via AI (for borderline cases) ─────────────────
  // Only fires when the question contains hint keywords but wasn't caught by regex.
  // Uses Nova micro with just 5 tokens — extremely cheap and fast.
  if (mightBePersonal(question)) {
    const isPersonalAI = await aiClassifyPersonal(question)
    if (isPersonalAI) {
      const supabaseEarly = getServiceSupabase()
      await logKBQuery(supabaseEarly, {
        queriedBy: member.id,
        queryText: question,
        wasBlocked: true,
        blockReason: 'ai_personal_query_classifier',
        personalTopicsFound: ['ai_detected_personal_intent'],
      })
      return NextResponse.json({
        answer: '⚠️ **Personal Query Detected**\n\nYour question appears to be asking for personal information about an individual, which is outside the scope of this project knowledge assistant.\n\nI\'m designed to help with work-related project knowledge only — tasks, deadlines, decisions, blockers, and deliverables. If you believe this was classified incorrectly, please rephrase your question to focus on a specific project or work item.',
        wasBlocked: true,
        responseType: 'text',
        kbEntriesUsed: 0,
        projectClusters: [],
        projectClusterDetails: [],
        tokensUsed: 0,
      })
    }
  }

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

  // ── Semantic Cache Check ───────────────────────────────────────────────────
  const requestsFile  = !!(explicitFormat || wantsFile(question))
  if (!requestsFile) {
    const cached = await getSemanticCache(supabase, question)
    if (cached) {
      console.log(`[Semantic Cache] Hit for: "${question}"`)
      
      const availableClusters = await fetchAllProjectClusters(supabase, member.role as TeamRole, member.id)
      const detected = detectProjectInQuery(question, availableClusters)
      const focus = detected ? detected.name : null

      let convId = conversationId
      if (!convId) {
        const { data: conv } = await supabase
          .from('agent_conversations')
          .insert({ member_id: member.id, title: question.slice(0, 70), project_focus: focus })
          .select('id').single()
        convId = conv?.id
      } else {
        await supabase.from('agent_conversations')
          .update({ updated_at: new Date().toISOString(), project_focus: focus })
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
            content:                     cached.responseText,
            kb_entries_referenced:       cached.kbEntriesReferenced,
            project_clusters_referenced: cached.projectClustersReferenced,
            response_type:               cached.responseType,
            tokens_used:                 0,
            was_blocked:                 false,
          })
          .select('id').single()
        messageId = aMsg?.id
      }

      await logKBQuery(supabase, {
        queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id,
        wasBlocked: false, kbEntriesAccessed: cached.kbEntriesReferenced,
        projectClustersHit: cached.projectClustersReferenced, responseType: cached.responseType,
      })

      return NextResponse.json({
        answer:               cached.responseText,
        wasBlocked:           false,
        responseType:         cached.responseType,
        projectClusters:      cached.projectClustersReferenced,
        projectClusterDetails: availableClusters.slice(0, 8).map(c => ({
          id: c.id, name: c.name, entryCount: c.entryCount,
        })),
        kbEntriesUsed:        cached.kbEntriesReferenced,
        kbStrategy:           'semantic_cache',
        conversationId:       convId,
        messageId,
        tokensUsed:           0,
        isClarifyingQuestion: false,
      })
    }
  }

  // ── Load history + visible members + all project clusters ───────────────────
  const [history, { ids: memberIds, map: memberMap }, availableClusters, dbProjectFocus] = await Promise.all([
    conversationId ? fetchHistory(supabase, conversationId) : Promise.resolve([] as HistoryMsg[]),
    resolveVisibleMembers(supabase, member.role as TeamRole),
    fetchAllProjectClusters(supabase, member.role as TeamRole, member.id),
    conversationId
      ? supabase
          .from('agent_conversations')
          .select('project_focus')
          .eq('id', conversationId)
          .maybeSingle()
          .then(({ data }) => data?.project_focus ?? null)
      : Promise.resolve(null),
  ])

  if (!memberIds.length) {
    return NextResponse.json({
      answer: 'No team member data found. Please check that your account is active and has proper role assignments.',
      wasBlocked: false, responseType: 'text', kbEntriesUsed: 0, projectClusters: [],
      projectClusterDetails: [], tokensUsed: 0,
    })
  }

  const isSingularProject = (
    (question.toLowerCase().includes('our project') ||
     question.toLowerCase().includes('the project') ||
     question.toLowerCase().includes('my project') ||
     question.toLowerCase().includes('this project') ||
     question.toLowerCase().includes('status of project')) &&
    !question.toLowerCase().includes('all project') &&
    !question.toLowerCase().includes('across project')
  )
  const isAggregation = isAggregationQuery(question) && !isSingularProject
  const isSpecific    = isSpecificQuery(question)

  // ── Project detection (query → history → hint from UI → DB focus → null) ────
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

  // 4. Try to resolve from the database conversation project focus
  if (!detectedProject && dbProjectFocus) {
    detectedProject = availableClusters.find(
      c => c.id === dbProjectFocus || c.name.toLowerCase() === dbProjectFocus.toLowerCase(),
    ) ?? null
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
      .or(`owner_member_id.in.(${memberIds.join(',')}),participant_member_ids.ov.{${memberIds.join(',')}}`)
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
      .insert({
        member_id: member.id,
        title: question.slice(0, 70),
        project_focus: detectedProject ? detectedProject.name : null,
      })
      .select('id').single()
    convId = conv?.id
  } else {
    await supabase.from('agent_conversations')
      .update({
        updated_at: new Date().toISOString(),
        project_focus: detectedProject ? detectedProject.name : null,
      })
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

  // Save to semantic cache for future similar queries
  if (safety.allowed && !requestsFile && strategy !== 'clarifying_question') {
    await setSemanticCache(supabase, question, {
      responseText:              finalAnswer,
      responseType:              respType,
      kbEntriesReferenced:       totalEntries,
      projectClustersReferenced: projectNames
    })
  }

  await logKBQuery(supabase, {
    queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id,
    wasBlocked: !safety.allowed, kbEntriesAccessed: totalEntries,
    projectClustersHit: projectNames, responseType: respType,
  })

  // Trigger throttled background sync asynchronously
  after(async () => {
    try {
      const supabaseAdmin = getServiceSupabase()
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
      const { count } = await supabaseAdmin
        .from('kb_sync_jobs')
        .select('id', { count: 'exact', head: true })
        .gt('started_at', twoMinutesAgo)

      if (count && count > 0) {
        console.log('[Agent Query] Background KB sync throttled (recent sync exists).')
        return
      }

      console.log('[Agent Query] Triggering background KB sync post-query...')
      await runKBSync()
    } catch (err) {
      console.error('[Agent Query] Background KB sync failed:', err)
    }
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
