import { SupabaseClient }                         from '@supabase/supabase-js'
import { classifyEmail }                          from '@/lib/classification'
import { summarizeForKB }                         from './summarizer'
import { generateEmbedding, buildEmbeddingText, formatVectorLiteral } from './embeddings'
import { EmailClassificationRule }                from '@/lib/supabase/types'
import { shouldSkipAIAnalysis }                   from '@/lib/ai/pre-filter'
import { AttachmentMeta }                         from '@/lib/gmail/thread'
import { indexAttachments }                       from '@/lib/attachments/indexer'

export interface IndexEmailParams {
  memberId:       string
  gmailThreadId:  string
  gmailMessageId: string
  fromEmail:      string
  toEmail:        string
  subject:        string
  threadText:     string    // full concatenated thread text
  snippet:        string    // first 500 chars
  emailDate:      string    // ISO string
  direction:      'inbound' | 'outbound' | 'thread'
  // Optional — when provided, attachments are indexed alongside the email
  attachments?:   AttachmentMeta[]
  accessToken?:   string
  refreshToken?:  string
}

export interface IndexResult {
  indexed: boolean
  reason: string
  kbEntryId?: string
}

/**
 * Core KB indexer. Classifies an email, summarizes it, generates an embedding,
 * and stores the result in email_knowledge_base.
 *
 * Raw email content is never stored — only AI-generated summaries.
 */
export async function indexEmailToKB(
  supabase: SupabaseClient,
  rules: EmailClassificationRule[],
  params: IndexEmailParams,
): Promise<IndexResult> {
  // Skip automated/newsletter emails before expensive AI calls
  const preFilter = shouldSkipAIAnalysis(params.fromEmail, params.subject, params.snippet)
  if (preFilter.skip) {
    return { indexed: false, reason: `Pre-filtered: ${preFilter.reason}` }
  }

  // Check for duplicate (already indexed)
  const { data: existing } = await supabase
    .from('email_knowledge_base')
    .select('id')
    .eq('gmail_thread_id', params.gmailThreadId)
    .eq('owner_member_id', params.memberId)
    .single()

  if (existing) {
    return { indexed: false, reason: 'Already indexed', kbEntryId: existing.id }
  }

  // Classify: project-related or personal?
  const classification = await classifyEmail(rules, {
    fromEmail: params.fromEmail,
    toEmail:   params.toEmail,
    subject:   params.subject,
    snippet:   params.snippet,
  })

  if (!classification.isProjectRelated) {
    return {
      indexed: false,
      reason: `Not project-related: ${classification.reason}`,
    }
  }

  // Summarize for KB (PII masked internally)
  const summary = await summarizeForKB({
    subject:    params.subject,
    fromEmail:  params.fromEmail,
    threadText: params.threadText,
  })

  // Find or create project cluster
  const clusterId = await upsertProjectCluster(
    supabase,
    summary.detectedProject,
    params.memberId,
  )

  // Generate vector embedding from summary text
  const embeddingText = buildEmbeddingText({
    summary:         summary.summary,
    keyPoints:       summary.keyPoints,
    actionItems:     summary.actionItems,
    detectedProject: summary.detectedProject,
    subject:         params.subject,
  })

  const embedding = await generateEmbedding(embeddingText)

  // Store KB entry
  const { data: entry, error } = await supabase
    .from('email_knowledge_base')
    .insert({
      owner_member_id:           params.memberId,
      project_cluster_id:        clusterId,
      gmail_thread_id:            params.gmailThreadId,
      gmail_message_id:           params.gmailMessageId,
      summary:                    summary.summary,
      key_points:                 summary.keyPoints,
      action_items:               summary.actionItems,
      participant_domains:        summary.participantDomains,
      direction:                  params.direction,
      email_date:                 params.emailDate,
      classification_confidence:  classification.confidence,
      classification_reason:      classification.reason,
      detected_project:           summary.detectedProject ?? classification.detectedProject,
      classification_source:      classification.source,
      embedding:                  formatVectorLiteral(embedding),
      pii_was_masked:             summary.piiWasMasked,
      tokens_used:                summary.tokensUsed,
    })
    .select('id')
    .single()

  if (error || !entry) {
    return { indexed: false, reason: `DB insert failed: ${error?.message}` }
  }

  // Index any attachments found in this email thread
  if (params.attachments?.length && params.accessToken) {
    await indexAttachments(
      supabase,
      entry.id,
      params.memberId,
      params.gmailThreadId,
      params.emailDate,
      params.attachments,
      params.accessToken,
      params.refreshToken,
    )
  }

  return { indexed: true, reason: 'Indexed successfully', kbEntryId: entry.id }
}

async function upsertProjectCluster(
  supabase: SupabaseClient,
  detectedProject: string | null,
  memberId: string,
): Promise<string | null> {
  if (!detectedProject) return null

  const { data: existing } = await supabase
    .from('project_clusters')
    .select('id, involved_member_ids')
    .ilike('name', detectedProject)
    .single()

  if (existing) {
    // Add this member if not already in the cluster
    const ids = existing.involved_member_ids ?? []
    if (!ids.includes(memberId)) {
      await supabase
        .from('project_clusters')
        .update({
          involved_member_ids: [...ids, memberId],
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
    }
    return existing.id
  }

  const { data: created } = await supabase
    .from('project_clusters')
    .insert({
      name:                detectedProject,
      involved_member_ids: [memberId],
      last_activity_at:    new Date().toISOString(),
    })
    .select('id')
    .single()

  return created?.id ?? null
}
