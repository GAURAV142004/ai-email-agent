import { SupabaseClient } from '@supabase/supabase-js'
import { generateEmbedding, formatVectorLiteral } from './embeddings'
import { KBSearchResult, TeamRole } from '@/lib/supabase/types'
import { VISIBILITY_MAP } from '@/lib/roles'

export interface KBSearchParams {
  query: string
  viewerRole: TeamRole
  viewerMemberId: string
  projectClusterId?: string
  memberIds?: string[]      // restrict to specific members
  dateFrom?: string
  dateTo?: string
  limit?: number
}

/**
 * Hybrid semantic + keyword search over the knowledge base.
 * Enforces visibility rules — viewer can only see entries from members
 * whose role is in VISIBILITY_MAP[viewerRole].
 */
export async function searchKB(
  supabase: SupabaseClient,
  params: KBSearchParams,
): Promise<KBSearchResult[]> {
  const limit = params.limit ?? 20

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(params.query)
  const vectorLiteral  = formatVectorLiteral(queryEmbedding)

  // Resolve which member IDs are visible to this viewer
  const visibleRoles = VISIBILITY_MAP[params.viewerRole]

  // Fetch visible members
  let memberQuery = supabase
    .from('team_members')
    .select('id, name, role')
    .in('role', visibleRoles)
    .eq('is_active', true)

  if (params.memberIds?.length) {
    memberQuery = memberQuery.in('id', params.memberIds)
  }

  const { data: visibleMembers } = await memberQuery

  if (!visibleMembers || visibleMembers.length === 0) {
    return []
  }

  const visibleMemberIds = visibleMembers.map(m => m.id)

  // Semantic search using pgvector cosine similarity
  // We use a raw SQL RPC for the vector operation
  const { data: entries, error } = await supabase.rpc('search_kb_by_embedding', {
    query_embedding: vectorLiteral,
    match_threshold: 0.3,
    match_count:     limit * 2, // fetch more then filter
    member_ids:      visibleMemberIds,
    date_from:       params.dateFrom ?? null,
    date_to:         params.dateTo ?? null,
    cluster_id:      params.projectClusterId ?? null,
  })

  if (error || !entries) {
    // Fallback: keyword search if vector search fails
    return keywordFallback(supabase, params, visibleMembers, limit)
  }

  // Build member lookup map
  const memberMap = new Map(visibleMembers.map(m => [m.id, m]))

  return (entries as any[])
    .slice(0, limit)
    .map(entry => ({
      entry,
      similarity: entry.similarity ?? 0,
      memberName: memberMap.get(entry.owner_member_id)?.name ?? 'Unknown',
      memberRole: memberMap.get(entry.owner_member_id)?.role ?? 'developer',
    })) as KBSearchResult[]
}

async function keywordFallback(
  supabase: SupabaseClient,
  params: KBSearchParams,
  visibleMembers: { id: string; name: string; role: string }[],
  limit: number,
): Promise<KBSearchResult[]> {
  const visibleMemberIds = visibleMembers.map(m => m.id)

  let query = supabase
    .from('email_knowledge_base')
    .select('*')
    .in('owner_member_id', visibleMemberIds)
    .or(`summary.ilike.%${params.query}%,detected_project.ilike.%${params.query}%`)
    .order('email_date', { ascending: false })
    .limit(limit)

  if (params.dateFrom) query = query.gte('email_date', params.dateFrom)
  if (params.dateTo)   query = query.lte('email_date', params.dateTo)

  const { data } = await query
  const memberMap = new Map(visibleMembers.map(m => [m.id, m]))

  return (data ?? []).map(entry => ({
    entry,
    similarity: 0.5,
    memberName: memberMap.get(entry.owner_member_id)?.name ?? 'Unknown',
    memberRole: (memberMap.get(entry.owner_member_id)?.role ?? 'developer') as TeamRole,
  }))
}
