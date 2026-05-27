import { SupabaseClient }                                          from '@supabase/supabase-js'
import { classifyEmail }                                           from '@/lib/classification'
import { summarizeForKB }                                          from './summarizer'
import { generateEmbedding, buildEmbeddingText, formatVectorLiteral } from './embeddings'
import { EmailClassificationRule }                                 from '@/lib/supabase/types'
import { shouldSkipAIAnalysis }                                    from '@/lib/ai/pre-filter'
import { AttachmentMeta }                                          from '@/lib/gmail/thread'
import { indexAttachments }                                        from '@/lib/attachments/indexer'
import { resolveEmailsToMemberIds, resolveThreadOwner }            from './participant-resolver'
import { fanOutToStructuredTables }                                from './structured-fanout'

export interface IndexEmailParams {
  memberId:       string          // the team member whose inbox is being synced
  gmailThreadId:  string
  gmailMessageId: string
  fromEmail:      string
  toEmail:        string          // primary To (legacy — kept for classification)
  toEmails:       string[]        // all To recipients from header
  ccEmails:       string[]        // all CC recipients from header
  subject:        string
  threadText:     string          // full concatenated thread text
  snippet:        string          // first 500 chars
  emailDate:      string          // ISO string
  direction:      'inbound' | 'outbound' | 'thread'
  // Optional — when provided, attachments are indexed alongside the email
  attachments?:   AttachmentMeta[]
  accessToken?:   string
  refreshToken?:  string
}

export interface IndexResult {
  indexed: boolean
  reason:  string
  kbEntryId?: string
  merged?:    boolean     // true when this thread was already in KB; we just added this member
}

/**
 * Core KB indexer. One entry per Gmail thread (global dedup).
 *
 * Strategy:
 *   1. Pre-filter newsletters / automated mail.
 *   2. Check if this gmail_thread_id ALREADY EXISTS in KB (global check).
 *      If yes → merge: add this syncing member to participant_member_ids and exit.
 *      This handles CC members' inboxes without re-indexing the same thread.
 *   3. If new → classify, summarize, embed, store.
 *   4. Fan-out structured data (action items, blockers, follow-ups) to dedicated tables.
 *
 * Raw email content is never stored — only AI-generated summaries.
 */
export async function indexEmailToKB(
  supabase: SupabaseClient,
  rules:    EmailClassificationRule[],
  params:   IndexEmailParams,
): Promise<IndexResult> {

  // ── Step 1: Pre-filter ────────────────────────────────────────────────────
  const preFilter = shouldSkipAIAnalysis(params.fromEmail, params.subject, params.snippet)
  if (preFilter.skip) {
    return { indexed: false, reason: `Pre-filtered: ${preFilter.reason}` }
  }

  // ── Step 2: Global dedup check ───────────────────────────────────────────
  // Check by gmail_thread_id ONLY (no owner filter) — thread is now globally unique.
  const { data: existing } = await supabase
    .from('email_knowledge_base')
    .select('id, participant_member_ids')
    .eq('gmail_thread_id', params.gmailThreadId)
    .maybeSingle()

  if (existing) {
    // Thread already indexed. Just add this member to participant_member_ids if not already there.
    const current = (existing.participant_member_ids as string[]) ?? []
    if (!current.includes(params.memberId)) {
      await supabase
        .from('email_knowledge_base')
        .update({ participant_member_ids: [...current, params.memberId] })
        .eq('id', existing.id)
    }
    return {
      indexed: false,
      merged:  true,
      reason:  'Thread already in KB — merged participant',
      kbEntryId: existing.id,
    }
  }

  // ── Step 3: Classify ─────────────────────────────────────────────────────
  const classification = await classifyEmail(rules, {
    fromEmail: params.fromEmail,
    toEmail:   params.toEmail,
    subject:   params.subject,
    snippet:   params.snippet,
  })

  if (!classification.isProjectRelated) {
    return {
      indexed: false,
      reason:  `Not project-related: ${classification.reason}`,
    }
  }

  // ── Step 4: Resolve participant team members ──────────────────────────────
  // Determine who is in To and CC, resolved to team member UUIDs.
  const [toMemberIds, ccMemberIds] = await Promise.all([
    resolveEmailsToMemberIds(supabase, params.toEmails),
    resolveEmailsToMemberIds(supabase, params.ccEmails),
  ])

  // Owner = the team member who is in the "To" field (falls back to syncing member).
  const ownerMemberId = toMemberIds[0]
    ?? (await resolveThreadOwner(supabase, params.toEmails, params.memberId))

  // All team members involved in this thread (To + CC + syncing member, deduped)
  const participantMemberIds = [
    ...new Set([...toMemberIds, ...ccMemberIds, params.memberId]),
  ]

  // ── Step 5: Summarize ────────────────────────────────────────────────────
  const { data: existingClusters } = await supabase
    .from('project_clusters')
    .select('name')
    .order('updated_at', { ascending: false })
    .limit(30)
  const existingProjects = (existingClusters ?? []).map((c: { name: string }) => c.name)

  const summary = await summarizeForKB({
    subject:          params.subject,
    fromEmail:        params.fromEmail,
    threadText:       params.threadText,
    existingProjects,
  })

  // ── Step 6: Upsert project cluster ──────────────────────────────────────
  const clusterId = await upsertProjectCluster(
    supabase,
    summary.detectedProject,
    participantMemberIds,
  )

  // ── Step 7: Embed ────────────────────────────────────────────────────────
  const embeddingText = buildEmbeddingText({
    summary:         summary.summary,
    keyPoints:       summary.keyPoints,
    actionItems:     summary.actionItems,
    detectedProject: summary.detectedProject,
    subject:         params.subject,
  })

  const embedding = await generateEmbedding(embeddingText)

  // ── Step 8: Insert KB entry ──────────────────────────────────────────────
  const { data: entry, error } = await supabase
    .from('email_knowledge_base')
    .insert({
      owner_member_id:            ownerMemberId,
      project_cluster_id:         clusterId,
      gmail_thread_id:             params.gmailThreadId,
      gmail_message_id:            params.gmailMessageId,
      // Participant tracking (NEW)
      to_emails:                   params.toEmails,
      cc_emails:                   params.ccEmails,
      participant_member_ids:      participantMemberIds,
      mentioned_persons:           summary.mentionedResponsiblePersons,
      // Structured extraction (NEW)
      email_type:                  summary.emailType,
      urgency:                     summary.urgency,
      awaiting_response_from:      summary.awaitingResponseFrom,
      decisions_made:              summary.decisionsMade,
      // Core KB fields
      summary:                     summary.summary,
      key_points:                  summary.keyPoints,
      action_items:                summary.actionItems,
      participant_domains:         summary.participantDomains,
      direction:                   params.direction,
      email_date:                  params.emailDate,
      classification_confidence:   classification.confidence,
      classification_reason:       classification.reason,
      detected_project:            summary.detectedProject ?? classification.detectedProject,
      classification_source:       classification.source,
      embedding:                   formatVectorLiteral(embedding),
      pii_was_masked:              summary.piiWasMasked,
      tokens_used:                 summary.tokensUsed,
    })
    .select('id')
    .single()

  if (error || !entry) {
    return { indexed: false, reason: `DB insert failed: ${error?.message}` }
  }

  // ── Step 9: Fan out to structured tables (non-critical) ─────────────────
  try {
    await fanOutToStructuredTables(supabase, {
      kbEntryId:        entry.id,
      projectClusterId: clusterId,
      gmailThreadId:    params.gmailThreadId,
      emailDate:        params.emailDate,
      summary,
    })
  } catch (fanOutErr: any) {
    // Fan-out failure is non-critical — KB entry is saved; structured tables
    // may be incomplete for this entry but won't break the overall pipeline.
    console.error(`[KB fanout] ${params.gmailThreadId}: ${fanOutErr?.message}`)
  }

  // ── Step 10: Index attachments (non-critical) ────────────────────────────
  if (params.attachments?.length && params.accessToken) {
    try {
      await indexAttachments(
        supabase,
        entry.id,
        ownerMemberId,
        params.gmailThreadId,
        params.emailDate,
        params.attachments,
        params.accessToken,
        params.refreshToken,
      )
    } catch {
      // Attachment indexing failure is non-critical
    }
  }

  return { indexed: true, reason: 'Indexed successfully', kbEntryId: entry.id }
}

// ── Upsert project cluster ────────────────────────────────────────────────────
// Now accepts all participant member IDs (not just the single owner).

async function upsertProjectCluster(
  supabase:            SupabaseClient,
  detectedProject:     string | null,
  participantMemberIds: string[],
): Promise<string | null> {
  if (!detectedProject) return null

  const { data: existing } = await supabase
    .from('project_clusters')
    .select('id, involved_member_ids')
    .ilike('name', detectedProject)
    .single()

  if (existing) {
    // Merge all participant IDs into the cluster's involved_member_ids
    const existingIds = new Set<string>(existing.involved_member_ids ?? [])
    const newIds      = participantMemberIds.filter(id => !existingIds.has(id))
    if (newIds.length) {
      await supabase
        .from('project_clusters')
        .update({
          involved_member_ids: [...existingIds, ...newIds],
          updated_at:          new Date().toISOString(),
        })
        .eq('id', existing.id)
    }
    return existing.id
  }

  const { data: created } = await supabase
    .from('project_clusters')
    .insert({
      name:                detectedProject,
      involved_member_ids: participantMemberIds,
      last_activity_at:    new Date().toISOString(),
    })
    .select('id')
    .single()

  return created?.id ?? null
}
