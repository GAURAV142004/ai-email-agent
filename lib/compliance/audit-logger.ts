import { SupabaseClient } from '@supabase/supabase-js'

export interface AuditLogParams {
  queriedBy: string           // team_members.id
  queryText: string
  queryAboutMemberId?: string
  wasBlocked: boolean
  blockReason?: string
  personalTopicsFound?: string[]
  kbEntriesAccessed?: number
  projectClustersHit?: string[]
  responseType?: string
}

/**
 * Records every KB chatbot query to the compliance_audit_logs table.
 * This is an append-only immutable log — never updated or deleted.
 * Used for compliance audits and privacy breach investigations.
 */
export async function logKBQuery(
  supabase: SupabaseClient,
  params: AuditLogParams,
): Promise<void> {
  await supabase.from('compliance_audit_logs').insert({
    queried_by:             params.queriedBy,
    query_text:             params.queryText,
    query_about_member_id:  params.queryAboutMemberId ?? null,
    was_blocked:            params.wasBlocked,
    block_reason:           params.blockReason ?? null,
    personal_topics_found:  params.personalTopicsFound ?? [],
    kb_entries_accessed:    params.kbEntriesAccessed ?? 0,
    project_clusters_hit:   params.projectClustersHit ?? [],
    response_type:          params.responseType ?? null,
  })
  // Intentionally fire-and-forget — log failures should not block the user response
}
