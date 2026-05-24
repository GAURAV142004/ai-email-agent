import { NextRequest, NextResponse } from 'next/server'
import { getConsentedMember, getServiceSupabase } from '@/lib/auth'
import { searchKB } from '@/lib/kb/search'
import { checkKBAccess, checkResponseSafety } from '@/lib/compliance/access-guard'
import { logKBQuery } from '@/lib/compliance/audit-logger'
import { checkRateLimit } from '@/lib/rate-limit'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import type { TeamRole } from '@/lib/roles'

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0'

async function synthesizeAnswer(question: string, results: any[]): Promise<{ text: string; tokensUsed: number }> {
  const ctx = results.map((r, i) => {
    const e = r.entry
    return [
      `[Entry ${i + 1}]`,
      `Member: ${r.memberName} (${r.memberRole})`,
      `Project: ${e.detected_project ?? 'Unknown'}`,
      `Date: ${e.email_date ? new Date(e.email_date).toLocaleDateString() : 'Unknown'}`,
      `Summary: ${e.summary}`,
      e.key_points?.length ? `Key Points: ${e.key_points.join(' | ')}` : null,
      e.action_items?.length ? `Action Items: ${e.action_items.map((a: any) => a.task).join(' | ')}` : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n---\n\n')

  const system = `You are an intelligent project knowledge assistant for a software delivery team.
Answer questions based ONLY on the provided KB entries from team email summaries.
Rules:
- Cite which team members and projects you are drawing from
- If information is not in the KB, clearly say so
- Never speculate about personal matters, health, finances, or relationships
- Structure long answers with clear headings
- For timelines use chronological order; for action items use bullet lists`

  const user = `Question: ${question}\n\nKB Entries (${results.length} relevant):\n${ctx}\n\nProvide a clear structured answer.`

  const body = JSON.stringify({
    messages: [{ role: 'user', content: [{ text: user }] }],
    system:   [{ text: system }],
    inferenceConfig: { maxTokens: 1200, temperature: 0.2 },
  })
  const resp   = await bedrock.send(new InvokeModelCommand({ modelId: MODEL_ID, contentType: 'application/json', accept: 'application/json', body: Buffer.from(body) }))
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getConsentedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized or consent not given' }, { status: 401 })

  // Rate limit: 30 queries per minute per member
  const rl = checkRateLimit(`agent:${member.id}`, 30, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before asking another question.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  const body            = await request.json().catch(() => ({}))
  const question        = (body?.question ?? '').trim()
  const conversationId  = body?.conversationId as string | undefined

  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 })
  if (question.length > 2000) return NextResponse.json({ error: 'Question too long (max 2000 chars)' }, { status: 400 })

  const supabase = getServiceSupabase()

  // Detect if query mentions a specific team member
  const { data: allMembers } = await supabase.from('team_members').select('id, name, role').eq('is_active', true)
  const mentioned = (allMembers ?? []).find((m: any) => question.toLowerCase().includes(m.name.toLowerCase())) as { id: string; name: string; role: TeamRole } | undefined

  // ── Compliance pre-check ────────────────────────────────────────────────────
  const access = checkKBAccess({ viewerRole: member.role, queryText: question, targetMemberRole: mentioned?.role })
  if (!access.allowed) {
    await logKBQuery(supabase, { queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id, wasBlocked: true, blockReason: access.blockReason ?? undefined, personalTopicsFound: access.personalTopicsFound })
    // Return a generic message — don't expose internal role/rule details
    const safeBlockMsg = 'This query touches on topics outside the scope of the project knowledge base and cannot be answered.'
    return NextResponse.json({ answer: safeBlockMsg, wasBlocked: true, responseType: 'text', kbEntriesUsed: 0, projectClusters: [], tokensUsed: 0 })
  }

  // ── KB search ───────────────────────────────────────────────────────────────
  const results = await searchKB(supabase, {
    query: question, viewerRole: member.role, viewerMemberId: member.id,
    memberIds: mentioned ? [mentioned.id] : undefined, limit: 15,
  })

  if (results.length === 0) {
    const noInfo = 'No relevant project information was found in the knowledge base for your query. The knowledge base may not have been synced recently, or this topic has not appeared in indexed emails.'
    await logKBQuery(supabase, { queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id, wasBlocked: false, kbEntriesAccessed: 0 })
    return NextResponse.json({ answer: noInfo, wasBlocked: false, responseType: 'text', kbEntriesUsed: 0, projectClusters: [], tokensUsed: 0 })
  }

  // ── AI synthesis ────────────────────────────────────────────────────────────
  let synth: { text: string; tokensUsed: number }
  try { synth = await synthesizeAnswer(question, results) }
  catch { synth = { text: results.map(r => `• ${r.memberName}: ${r.entry.summary}`).join('\n'), tokensUsed: 0 } }

  // ── Post-response safety ────────────────────────────────────────────────────
  const safety      = checkResponseSafety(synth.text)
  const finalAnswer = safety.allowed ? synth.text : safety.blockReason!
  const respType    = detectResponseType(finalAnswer)
  const clusters    = [...new Set(results.map(r => r.entry.detected_project).filter(Boolean) as string[])]

  // ── Persist conversation ────────────────────────────────────────────────────
  let convId = conversationId
  if (!convId) {
    const { data: conv } = await supabase.from('agent_conversations').insert({ member_id: member.id, title: question.slice(0, 60) }).select('id').single()
    convId = conv?.id
  } else {
    await supabase.from('agent_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId).eq('member_id', member.id)
  }
  if (convId) {
    await supabase.from('agent_messages').insert([
      { conversation_id: convId, role: 'user', content: question },
      { conversation_id: convId, role: 'assistant', content: finalAnswer, kb_entries_referenced: results.length, project_clusters_referenced: clusters, response_type: respType, tokens_used: synth.tokensUsed, was_blocked: !safety.allowed, block_reason: safety.allowed ? null : safety.blockReason },
    ])
  }

  // ── Audit log ───────────────────────────────────────────────────────────────
  await logKBQuery(supabase, { queriedBy: member.id, queryText: question, queryAboutMemberId: mentioned?.id, wasBlocked: !safety.allowed, blockReason: safety.allowed ? undefined : (safety.blockReason ?? undefined), personalTopicsFound: safety.personalTopicsFound, kbEntriesAccessed: results.length, projectClustersHit: clusters, responseType: respType })

  return NextResponse.json({ answer: finalAnswer, wasBlocked: !safety.allowed, blockReason: safety.allowed ? undefined : safety.blockReason, responseType: respType, projectClusters: clusters, kbEntriesUsed: results.length, conversationId: convId, tokensUsed: synth.tokensUsed })
}
