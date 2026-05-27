import { SupabaseClient }                         from '@supabase/supabase-js'
import { generateEmbedding, formatVectorLiteral } from './embeddings'
import { VISIBILITY_MAP }                         from '@/lib/roles'
import type { TeamRole }                          from '@/lib/roles'
import type { KBSearchResult }                    from '@/lib/supabase/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProjectCluster {
  id:               string
  name:             string
  entryCount:       number
  lastActivityAt:   string | null
}

export interface ProjectFetchResult {
  entries:     KBSearchResult[]
  projectName: string
  clusterId:   string
  totalInDB:   number    // how many entries exist in DB for this project
  strategy:    'full' | 'vector_within' | 'hybrid'
}

// ── Fetch all visible project clusters ────────────────────────────────────────

export async function fetchAllProjectClusters(
  supabase:       SupabaseClient,
  viewerRole:     TeamRole,
  viewerMemberId: string,
): Promise<ProjectCluster[]> {
  const visibleRoles = VISIBILITY_MAP[viewerRole]

  const { data: visibleMembers } = await supabase
    .from('team_members')
    .select('id')
    .in('role', visibleRoles)
    .eq('is_active', true)

  if (!visibleMembers?.length) return []
  const memberIds = visibleMembers.map(m => m.id)

  const { data } = await supabase.rpc('get_visible_project_clusters', {
    p_member_ids: memberIds,
  })

  return (data ?? []).map((row: any) => ({
    id:             row.id,
    name:           row.name,
    entryCount:     Number(row.entry_count ?? 0),
    lastActivityAt: row.last_activity_at ?? null,
  }))
}

// ── Detect project name in query ──────────────────────────────────────────────
// Returns the best matching project cluster if the query mentions one.
// Uses fuzzy matching (lowercased, partial) to handle "infosys" matching "Infosys Portal".

export function detectProjectInQuery(
  query:    string,
  clusters: ProjectCluster[],
): ProjectCluster | null {
  if (!clusters.length || !query.trim()) return null

  const q = query.toLowerCase()

  // Exact or contained match (e.g. query says "infosys" and cluster is "Infosys Portal")
  let best: ProjectCluster | null     = null
  let bestScore                       = 0

  for (const cluster of clusters) {
    const name  = cluster.name.toLowerCase()
    const words = name.split(/\s+/)

    // Score: longest matching word sequence
    for (const word of words) {
      if (word.length >= 3 && q.includes(word)) {
        const score = word.length
        if (score > bestScore) {
          bestScore = score
          best      = cluster
        }
      }
    }
    // Full name match gets highest priority
    if (q.includes(name)) {
      best      = cluster
      bestScore = 9999
      break
    }
  }

  // Only return if we have a reasonably confident match (word length >= 4)
  return bestScore >= 4 ? best : null
}

// ── Resolve project from history ──────────────────────────────────────────────
// Looks at the last few user messages to find a project name they've already mentioned.

export function detectProjectInHistory(
  history:  Array<{ role: string; content: string }>,
  clusters: ProjectCluster[],
): ProjectCluster | null {
  if (!history.length || !clusters.length) return null

  // Check the last 6 user messages (most recent first)
  const recentUserMessages = history
    .slice(-6)
    .filter(m => m.role === 'user')
    .reverse()

  for (const msg of recentUserMessages) {
    const found = detectProjectInQuery(msg.content, clusters)
    if (found) return found
  }

  return null
}

// ── Option C: Hybrid fetch — full recent + vector-within for specific queries ─
// Strategy:
//   - ALWAYS fetch latest 40 entries (chronological context)
//   - IF the query is specific (detailed/targeted), ALSO do vector search within project
//     and merge the two sets (dedup by id), prioritising vector matches for ranking
//   - The AI gets richer context this way

export async function fetchProjectKBHybrid(
  supabase:   SupabaseClient,
  clusterId:  string,
  memberIds:  string[],
  query:      string,
  memberMap:  Map<string, { name: string; role: string }>,
  isSpecific: boolean,   // true = targeted query, false = general status/overview
): Promise<{ results: KBSearchResult[]; strategy: 'full' | 'vector_within' | 'hybrid' }> {

  // Always fetch the latest 40 entries chronologically
  const { data: fullEntries } = await supabase.rpc('get_project_kb_entries', {
    p_cluster_id: clusterId,
    p_member_ids: memberIds,
    p_limit:      40,
  })

  const fullResults: KBSearchResult[] = (fullEntries ?? []).map((entry: any) => ({
    entry,
    similarity: 0.8,   // base confidence for date-sorted entries
    memberName: (memberMap.get(entry.owner_member_id) as any)?.name ?? 'Unknown',
    memberRole: ((memberMap.get(entry.owner_member_id) as any)?.role ?? 'developer') as TeamRole,
  }))

  // For non-specific queries (status overview, project summary), full fetch is enough
  if (!isSpecific) {
    return { results: fullResults, strategy: 'full' }
  }

  // For specific queries, ALSO do vector search within this project
  try {
    const queryEmbedding = await generateEmbedding(query)
    const vectorLiteral  = formatVectorLiteral(queryEmbedding)

    const { data: vectorEntries } = await supabase.rpc('search_kb_by_embedding_in_project', {
      query_embedding: vectorLiteral,
      match_threshold: 0.25,
      match_count:     20,
      member_ids:      memberIds,
      cluster_id:      clusterId,
    })

    const vectorResults: KBSearchResult[] = ((vectorEntries ?? []) as any[]).map(entry => ({
      entry,
      similarity: entry.similarity ?? 0,
      memberName: (memberMap.get(entry.owner_member_id) as any)?.name ?? 'Unknown',
      memberRole: ((memberMap.get(entry.owner_member_id) as any)?.role ?? 'developer') as TeamRole,
    }))

    if (!vectorResults.length) {
      return { results: fullResults, strategy: 'full' }
    }

    // Merge: vector-matched entries get boosted similarity; dedup by id
    const merged = new Map<string, KBSearchResult>()

    // Start with full results (lower score)
    for (const r of fullResults) {
      merged.set(r.entry.id, r)
    }

    // Overlay with vector results (higher score wins)
    for (const r of vectorResults) {
      const existing = merged.get(r.entry.id)
      if (!existing || r.similarity > existing.similarity) {
        merged.set(r.entry.id, { ...r, similarity: Math.min(r.similarity + 0.15, 1) })
      }
    }

    // Sort: vector-boosted entries first, then by date
    const sorted = [...merged.values()].sort((a, b) => b.similarity - a.similarity)

    return { results: sorted.slice(0, 50), strategy: 'hybrid' }

  } catch {
    // Vector search failed — fall back to full chronological fetch
    return { results: fullResults, strategy: 'full' }
  }
}

// ── Multi-project aggregation fetch ──────────────────────────────────────────
// For queries like "all blockers", "go-live dates", "action items across all projects".
// Fetches recent entries from EVERY project, grouped and capped per project.

export async function fetchMultiProjectKB(
  supabase:   SupabaseClient,
  memberIds:  string[],
  memberMap:  Map<string, { name: string; role: string }>,
  limitPerProject = 8,
): Promise<Map<string, KBSearchResult[]>> {
  const { data: entries } = await supabase.rpc('get_multi_project_kb_summary', {
    p_member_ids:          memberIds,
    p_limit_per_project:   limitPerProject,
  })

  const grouped = new Map<string, KBSearchResult[]>()

  for (const entry of (entries ?? []) as any[]) {
    const projectName = entry.detected_project ?? 'Unknown'
    if (!grouped.has(projectName)) grouped.set(projectName, [])

    const list = grouped.get(projectName)!
    if (list.length < limitPerProject) {
      list.push({
        entry,
        similarity: 0.75,
        memberName: (memberMap.get(entry.owner_member_id) as any)?.name ?? 'Unknown',
        memberRole: ((memberMap.get(entry.owner_member_id) as any)?.role ?? 'developer') as TeamRole,
      })
    }
  }

  return grouped
}

// ── Build rich KB context string for a single project ────────────────────────
// Creates a structured, timeline-aware context for AI consumption.

export function buildProjectContext(
  results:     KBSearchResult[],
  projectName: string,
  strategy:    string,
): string {
  if (!results.length) return ''

  const header = `=== PROJECT: ${projectName.toUpperCase()} === (${results.length} emails, strategy: ${strategy})`

  const body = results.map((r, i) => {
    const e   = r.entry
    const date = e.email_date
      ? new Date(e.email_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : 'Unknown date'

    const actionStr = (e.action_items as any[] ?? [])
      .map((a: any) =>
        `${a.owner_hint ?? 'Team'} → ${a.task}${a.due_date_hint ? ` (by ${a.due_date_hint})` : ''}`,
      )
      .join(' | ')

    return [
      `[${i + 1}] ${date}${r.similarity > 0.85 ? ' ★ highly relevant' : ''}`,
      `Summary: ${e.summary}`,
      e.key_points?.length ? `Facts: ${(e.key_points as string[]).join(' • ')}` : null,
      actionStr             ? `Actions: ${actionStr}` : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  return `${header}\n${body}`
}

// ── Build multi-project aggregation context ───────────────────────────────────

export function buildMultiProjectContext(
  grouped: Map<string, KBSearchResult[]>,
): string {
  const sections: string[] = []

  for (const [projectName, results] of grouped) {
    if (!results.length) continue

    const entries = results.map((r, i) => {
      const e    = r.entry
      const date = e.email_date
        ? new Date(e.email_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'Unknown date'

      const actionStr = (e.action_items as any[] ?? [])
        .map((a: any) => `${a.owner_hint ?? 'Team'} → ${a.task}${a.due_date_hint ? ` (by ${a.due_date_hint})` : ''}`)
        .join(' | ')

      return [
        `  [${i + 1}] ${date}: ${e.summary}`,
        e.key_points?.length ? `  Facts: ${(e.key_points as string[]).join(' • ')}` : null,
        actionStr             ? `  Actions: ${actionStr}` : null,
      ].filter(Boolean).join('\n')
    }).join('\n')

    sections.push(`--- ${projectName} ---\n${entries}`)
  }

  return sections.length ? `=== ALL PROJECTS OVERVIEW ===\n${sections.join('\n\n')}` : ''
}

// ── Detect if query is specific/targeted or general ──────────────────────────
// Specific queries get vector-within-project boost (hybrid mode).
// General queries (status, summary, overview) use full chronological fetch.

const GENERAL_PATTERNS = [
  /\b(status|progress|overview|summary|update|how.{0,10}going|what.{0,15}happening)\b/i,
  /\b(latest|recent|last|current|this week|this month)\b/i,
  /\b(tell me about|brief me|catch me up|what do you know)\b/i,
]

export function isSpecificQuery(query: string): boolean {
  // If any general pattern matches, it's a general query → NOT specific
  if (GENERAL_PATTERNS.some(p => p.test(query))) return false

  // Queries with specific dates, names, numbers, or technical terms are specific
  const hasDate    = /\b(\d{1,2}[\/\-]\d{1,2}|\bjan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(query)
  const hasNumber  = /\b\d+\b/.test(query)
  const hasKeyword = /\b(bug|defect|fix|deploy|release|api|module|feature|issue|error|decision|approved|agreed|signed|contract|sla)\b/i.test(query)
  const isLong     = query.trim().split(/\s+/).length > 8

  return hasDate || hasNumber || hasKeyword || isLong
}
