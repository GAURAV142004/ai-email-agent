import { SupabaseClient }                          from '@supabase/supabase-js'
import { generateEmbedding, formatVectorLiteral }  from './embeddings'
import { KBSearchResult, AttachmentSearchResult, TeamRole } from '@/lib/supabase/types'
import { VISIBILITY_MAP }                          from '@/lib/roles'

export interface KBSearchParams {
  query: string
  viewerRole: TeamRole
  viewerMemberId: string
  projectClusterId?: string
  memberIds?: string[]
  dateFrom?: string
  dateTo?: string
  limit?: number
}

// ─── Keyword search (PostgreSQL full-text) ────────────────────────────────────
// Searches the tsvector column built by migration 013.
// Returns raw entries ranked by text relevance — no similarity score.
async function keywordSearchKB(
  supabase:         SupabaseClient,
  params:           KBSearchParams,
  visibleMemberIds: string[],
  limit:            number,
): Promise<any[]> {
  // Strip punctuation and very short words for a clean tsquery
  const cleanQuery = params.query
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .join(' ')

  if (!cleanQuery) return []

  let q = supabase
    .from('email_knowledge_base')
    .select('*')
    .in('owner_member_id', visibleMemberIds)
    .textSearch('search_vector', cleanQuery, { type: 'plain', config: 'english' })
    .limit(limit)

  if (params.dateFrom)         q = q.gte('email_date', params.dateFrom)
  if (params.dateTo)           q = q.lte('email_date', params.dateTo)
  if (params.projectClusterId) q = q.eq('project_cluster_id', params.projectClusterId)

  const { data } = await q
  return data ?? []
}

// ─── Reciprocal Rank Fusion ───────────────────────────────────────────────────
// Standard RRF formula: score(d) = Σ 1 / (k + rank(d))
// Entries appearing in BOTH result sets get boosted — they match semantically AND lexically.
function reciprocalRankFusion(
  vectorResults:  KBSearchResult[],
  keywordEntries: any[],
  memberMap:      Map<string, { name: string; role: string }>,
  limit:          number,
  k = 60,
): KBSearchResult[] {
  const scores  = new Map<string, number>()
  const entries = new Map<string, KBSearchResult>()

  vectorResults.forEach((r, i) => {
    const id = r.entry.id
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1))
    entries.set(id, r)
  })

  keywordEntries.forEach((entry, i) => {
    const id = entry.id
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1))
    if (!entries.has(id)) {
      entries.set(id, {
        entry,
        similarity: 0,
        memberName: (memberMap.get(entry.owner_member_id) as any)?.name ?? 'Unknown',
        memberRole: ((memberMap.get(entry.owner_member_id) as any)?.role ?? 'developer') as TeamRole,
      })
    }
  })

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({
      ...entries.get(id)!,
      similarity: Math.min(score * 8, 1),   // normalise to ~0–1 range for display
    }))
}

// ─── Hybrid KB search (vector + keyword, merged with RRF) ────────────────────
export async function searchKB(
  supabase: SupabaseClient,
  params:   KBSearchParams,
): Promise<KBSearchResult[]> {
  const limit = params.limit ?? 20

  // Resolve which members are visible to this viewer
  const visibleRoles = VISIBILITY_MAP[params.viewerRole]
  let memberQuery = supabase
    .from('team_members')
    .select('id, name, role')
    .in('role', visibleRoles)
    .eq('is_active', true)

  if (params.memberIds?.length) memberQuery = memberQuery.in('id', params.memberIds)

  const { data: visibleMembers } = await memberQuery
  if (!visibleMembers || visibleMembers.length === 0) return []

  const visibleMemberIds = visibleMembers.map(m => m.id)
  const memberMap = new Map(visibleMembers.map(m => [m.id, m]))

  // Generate embedding once, then fire both searches in parallel
  const queryEmbedding = await generateEmbedding(params.query)
  const vectorLiteral  = formatVectorLiteral(queryEmbedding)

  const [vectorRaw, keywordEntries] = await Promise.all([
    supabase.rpc('search_kb_by_embedding', {
      query_embedding: vectorLiteral,
      match_threshold: 0.2,           // slightly lower — keyword search compensates for false negatives
      match_count:     limit * 2,
      member_ids:      visibleMemberIds,
      date_from:       params.dateFrom ?? null,
      date_to:         params.dateTo   ?? null,
      cluster_id:      params.projectClusterId ?? null,
    }),
    keywordSearchKB(supabase, params, visibleMemberIds, limit * 2),
  ])

  const vectorResults: KBSearchResult[] = ((vectorRaw.data ?? []) as any[])
    .slice(0, limit * 2)
    .map(entry => ({
      entry,
      similarity: entry.similarity ?? 0,
      memberName: (memberMap.get(entry.owner_member_id) as any)?.name ?? 'Unknown',
      memberRole: ((memberMap.get(entry.owner_member_id) as any)?.role ?? 'developer') as TeamRole,
    }))

  // Both empty → try simple keyword fallback
  if (vectorResults.length === 0 && keywordEntries.length === 0) {
    return keywordFallback(supabase, params, visibleMembers, limit)
  }

  // Merge with RRF
  return reciprocalRankFusion(vectorResults, keywordEntries, memberMap, limit)
}

// ─── Attachment search (vector only — no tsvector on attachments table yet) ──
export async function searchAttachments(
  supabase: SupabaseClient,
  params:   KBSearchParams,
): Promise<AttachmentSearchResult[]> {
  const limit = params.limit ?? 10

  const queryEmbedding = await generateEmbedding(params.query)
  const vectorLiteral  = formatVectorLiteral(queryEmbedding)

  const visibleRoles = VISIBILITY_MAP[params.viewerRole]

  let memberQuery = supabase
    .from('team_members')
    .select('id, name, role')
    .in('role', visibleRoles)
    .eq('is_active', true)

  if (params.memberIds?.length) memberQuery = memberQuery.in('id', params.memberIds)

  const { data: visibleMembers } = await memberQuery
  if (!visibleMembers?.length) return []

  const visibleMemberIds = visibleMembers.map(m => m.id)

  const { data: entries, error } = await supabase.rpc('search_attachments_by_embedding', {
    query_embedding: vectorLiteral,
    match_threshold: 0.3,
    match_count:     limit * 2,
    member_ids:      visibleMemberIds,
    date_from:       params.dateFrom ?? null,
    date_to:         params.dateTo   ?? null,
  })

  if (error || !entries) return []

  const memberMap = new Map(visibleMembers.map(m => [m.id, m]))

  return (entries as any[])
    .slice(0, limit)
    .map(att => ({
      attachment: att,
      similarity: att.similarity ?? 0,
      memberName: (memberMap.get(att.owner_member_id) as any)?.name ?? 'Unknown',
      memberRole: ((memberMap.get(att.owner_member_id) as any)?.role ?? 'developer') as TeamRole,
    })) as AttachmentSearchResult[]
}

// ─── Simple keyword fallback (when both vector + text search return nothing) ──
async function keywordFallback(
  supabase:       SupabaseClient,
  params:         KBSearchParams,
  visibleMembers: { id: string; name: string; role: string }[],
  limit:          number,
): Promise<KBSearchResult[]> {
  const visibleMemberIds = visibleMembers.map(m => m.id)
  const q = params.query.replace(/'/g, "''")

  let query = supabase
    .from('email_knowledge_base')
    .select('*')
    .in('owner_member_id', visibleMemberIds)
    .or([
      `summary.ilike.%${q}%`,
      `detected_project.ilike.%${q}%`,
    ].join(','))
    .order('email_date', { ascending: false })
    .limit(limit)

  if (params.dateFrom) query = query.gte('email_date', params.dateFrom)
  if (params.dateTo)   query = query.lte('email_date', params.dateTo)

  const { data }    = await query
  const memberMap   = new Map(visibleMembers.map(m => [m.id, m]))

  return (data ?? []).map(entry => ({
    entry,
    similarity: 0.5,
    memberName: (memberMap.get(entry.owner_member_id) as any)?.name ?? 'Unknown',
    memberRole: ((memberMap.get(entry.owner_member_id) as any)?.role ?? 'developer') as TeamRole,
  }))
}
