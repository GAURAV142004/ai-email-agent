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

// ── Fetch prior turns for conversation memory ────────────────────────────────
async function fetchConversationHistory(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { data: msgs } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(10)  // last 5 turns (user + assistant pairs)

  return (msgs ?? []).filter(
    (m): m is { role: 'user' | 'assistant'; content: string } =>
      m.role === 'user' || m.role === 'assistant',
  )
}

// ── AI synthesis with conversation memory ────────────────────────────────────
async function synthesizeAnswer(
  question:           string,
  emailResults:       KBSearchResult[],
  attachmentResults:  AttachmentSearchResult[],
  history:            Array<{ role: 'user' | 'assistant'; content: string }>,
  projectFocus:       string | null,
): Promise<{ text: string; tokensUsed: number }> {
  // Build KB context block
  const emailCtx = emailResults.map((r, i) => {
    const e = r.entry
    return [
      `[Email ${i + 1}]`,
      `Member: ${r.memberName} (${r.memberRole})`,
      `Project: ${e.detected_project ?? 'Unknown'}`,
      `Date: ${e.email_date ? new Date(e.email_date).toLocaleDateString() : 'Unknown'}`,
      `Summary: ${e.summary}`,
      e.key_points?.length   ? `Key Points: ${e.key_points.join(' | ')}`                                         : null,
      e.action_items?.length ? `Action Items: ${(e.action_items as any[]).map((a: any) => a.task).join(' | ')}` : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n---\n\n')

  const attachCtx = attachmentResults.map((r, i) => {
    const a = r.attachment
    return [
      `[Document ${i + 1}]`,
      `File: ${a.filename}`,
      `Shared by: ${r.memberName} (${r.memberRole})`,
      `Date: ${a.email_date ? new Date(a.email_date).toLocaleDateString() : 'Unknown'}`,
      `Summary: ${a.summary ?? 'No summary available'}`,
      a.key_points?.length ? `Key Points: ${a.key_points.join(' | ')}` : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n---\n\n')

  const totalSources = emailResults.length + attachmentResults.length
  const kbCtx = [
    emailCtx  ? `=== EMAIL SUMMARIES ===\n${emailCtx}`       : null,
    attachCtx ? `=== DOCUMENT ATTACHMENTS ===\n${attachCtx}` : null,
  ].filter(Boolean).join('\n\n')

  const projectLine = projectFocus
    ? `The user is specifically asking about: "${projectFocus}". Prioritise information related to this project/topic.`
    : 'The user is asking a general question across all projects.'

  const system = `You are a project knowledge assistant for a software delivery team.
You answer questions using ONLY the KB data provided. You have no other knowledge.
When the user refers to something from earlier in the conversation, use the conversation history.
${projectLine}

RESPONSE RULES — follow strictly, no exceptions:
1. Start with the direct answer. Never restate the question.
2. Be concise: 1-4 sentences for simple facts, a short bullet list for 3+ items.
3. Never write filler: no "In summary", "Moving forward", "By following this", "This ensures", "Overall".
4. Never add per-point source labels like "Source:" or "Reference:". If citing, do it once inline: "(from [Name], [date])".
5. Never hedge with "it appears", "it seems", "it was mentioned that". State facts directly.
6. If the answer is not in the KB data or prior conversation, write only: "Not in the knowledge base."
7. When listing action items, show: owner → task → due date (if known). No extra prose.
8. When referencing a document, state its filename and the date it was shared.
9. Never add conclusions or closing remarks.`

  // Build multi-turn messages array (Nova supports native conversation history)
  const messages: Array<{ role: string; content: Array<{ text: string }> }> = []

  // Include last 6 messages (3 turns) as conversation context
  for (const msg of history.slice(-6)) {
    messages.push({ role: msg.role, content: [{ text: msg.content }] })
  }

  // Current question with fresh KB context
  const userTurn = `Question: ${question}

KB Data (${totalSources} sources):
${kbCtx}

Answer:`

  messages.push({ role: 'user', content: [{ text: userTurn }] })

  const body = JSON.stringify({
    messages,
    system:          [{ text: system }],
    inferenceConfig: { maxTokens: 1200, temperature: 0.2 },
  })

  const resp   = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID, contentType: 'application/json', accept: 'application/json', body: Buffer.from(body),
  }))
  const parsed = JSON.parse(Buffer.from(resp.body).toString('utf-8'))

  return {
    text:       parsed.output?.message?.content?.[0]?.text ?? '',
    tokensUsed: (parsed.usage?.inputTokens ?? 0) + (parsed.usage?.outputTokens ?? 0),
  }
}

function detectResponseType(text: string): string {
  if (/\|\s*[-:]\s*\|/.test(text) || text.includes('| --- |')) return 'table'
  if (/#{1,3}\s/.test(text)) return 'report'
  if (/\d{4}-\d{2}-\d{2}|Q[1-4]\s+\d{4}/i.test(text)) return 'timeline'
  return 'text'
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getConsentedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized or consent not given' }, { status: 401 })

  // Rate limit: 30 queries per minute per member
  const rl = checkRateLimit(`agent:${member.id}`, 30, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before asking another question.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    )
  }

  const body           = await request.json().catch(() => ({}))
  const question       = (body?.question ?? '').trim()
  const conversationId = body?.conversationId as string | undefined
  const projectFocus   = (body?.projectFocus as string | undefined) ?? null

  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 })
  if (question.length > 2000) return NextResponse.json({ error: 'Question too long (max 2000 chars)' }, { status: 400 })

  const supabase = getServiceSupabase()

  // Detect if query mentions a specific team member
  const { data: allMembers } = await supabase.from('team_members').select('id, name, role').eq('is_active', true)
  const mentioned = (allMembers ?? []).find(
    (m: any) => question.toLowerCase().includes(m.name.toLowerCase()),
  ) as { id: string; name: string; role: TeamRole } | undefined

  // ── Compliance pre-check ──────────────────────────────────────────────────
  const access = checkKBAccess({ viewerRole: member.role, queryText: question, targetMemberRole: mentioned?.role })
  if (!access.allowed) {
    await logKBQuery(supabase, {
      queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id,
      wasBlocked: true, blockReason: access.blockReason ?? undefined, personalTopicsFound: access.personalTopicsFound,
    })
    const safeBlockMsg = 'This query touches on topics outside the scope of the project knowledge base and cannot be answered.'
    return NextResponse.json({ answer: safeBlockMsg, wasBlocked: true, responseType: 'text', kbEntriesUsed: 0, projectClusters: [], tokensUsed: 0 })
  }

  // ── Load conversation history (for AI memory) ──────────────────────────────
  const history = conversationId
    ? await fetchConversationHistory(supabase, conversationId)
    : []

  // ── KB search — emails + attachments in parallel ──────────────────────────
  const searchParams = {
    query: question, viewerRole: member.role, viewerMemberId: member.id,
    memberIds: mentioned ? [mentioned.id] : undefined,
  }

  const [emailResults, attachmentResults] = await Promise.all([
    searchKB(supabase,          { ...searchParams, limit: 12 }),
    searchAttachments(supabase, { ...searchParams, limit: 8  }),
  ])

  const totalSources = emailResults.length + attachmentResults.length

  if (totalSources === 0 && history.length === 0) {
    const noInfo = 'No relevant project information was found in the knowledge base for your query. The knowledge base may not have been synced recently, or this topic has not appeared in indexed emails or documents.'
    await logKBQuery(supabase, { queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id, wasBlocked: false, kbEntriesAccessed: 0 })
    return NextResponse.json({ answer: noInfo, wasBlocked: false, responseType: 'text', kbEntriesUsed: 0, projectClusters: [], tokensUsed: 0 })
  }

  // ── AI synthesis ──────────────────────────────────────────────────────────
  let synth: { text: string; tokensUsed: number }
  try {
    synth = await synthesizeAnswer(question, emailResults, attachmentResults, history, projectFocus)
  } catch {
    const fallback = [
      ...emailResults.map(r      => `• ${r.memberName}: ${r.entry.summary}`),
      ...attachmentResults.map(r => `• [Doc] ${r.attachment.filename}: ${r.attachment.summary}`),
    ].join('\n')
    synth = { text: fallback || 'No relevant information found.', tokensUsed: 0 }
  }

  // ── Post-response safety ──────────────────────────────────────────────────
  const safety      = checkResponseSafety(synth.text)
  const finalAnswer = safety.allowed ? synth.text : safety.blockReason!
  const respType    = detectResponseType(finalAnswer)
  const clusters    = [...new Set(emailResults.map(r => r.entry.detected_project).filter(Boolean) as string[])]

  // ── Persist conversation + messages ───────────────────────────────────────
  let convId = conversationId
  if (!convId) {
    const { data: conv } = await supabase
      .from('agent_conversations')
      .insert({
        member_id:     member.id,
        title:         projectFocus ? `[${projectFocus}] ${question.slice(0, 50)}` : question.slice(0, 60),
        project_focus: projectFocus,
      })
      .select('id')
      .single()
    convId = conv?.id
  } else {
    await supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId)
      .eq('member_id', member.id)
  }

  let messageId: string | undefined
  if (convId) {
    // Insert user message
    await supabase.from('agent_messages').insert({
      conversation_id: convId, role: 'user', content: question,
    })
    // Insert assistant message and capture its ID
    const { data: aMsg } = await supabase
      .from('agent_messages')
      .insert({
        conversation_id:             convId,
        role:                        'assistant',
        content:                     finalAnswer,
        kb_entries_referenced:       totalSources,
        project_clusters_referenced: clusters,
        response_type:               respType,
        tokens_used:                 synth.tokensUsed,
        was_blocked:                 !safety.allowed,
        block_reason:                safety.allowed ? null : safety.blockReason,
      })
      .select('id')
      .single()
    messageId = aMsg?.id
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  await logKBQuery(supabase, {
    queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id,
    wasBlocked: !safety.allowed, blockReason: safety.allowed ? undefined : (safety.blockReason ?? undefined),
    personalTopicsFound: safety.personalTopicsFound, kbEntriesAccessed: totalSources,
    projectClustersHit: clusters, responseType: respType,
  })

  return NextResponse.json({
    answer:          finalAnswer,
    wasBlocked:      !safety.allowed,
    blockReason:     safety.allowed ? undefined : safety.blockReason,
    responseType:    respType,
    projectClusters: clusters,
    kbEntriesUsed:   totalSources,
    conversationId:  convId,
    projectFocus,
    messageId,
    tokensUsed:      synth.tokensUsed,
  })
}
