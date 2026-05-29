import { SupabaseClient }                    from '@supabase/supabase-js'
import { KBSummaryResult }                    from './summarizer'
import { resolveMentionedNamesToMembers }     from './participant-resolver'

// ── Fan-out extracted KB data into a unified, dynamic table ───────────────────
//
// Extracts action items, blockers, decisions, and follow-ups from the AI summary
// and writes them to the unified `project_operational_items` table.
// This supports generic, dynamic query categories and precise SQL-based retrieval.
// ─────────────────────────────────────────────────────────────────────────────

export interface FanOutParams {
  kbEntryId:        string
  projectClusterId: string | null
  gmailThreadId:    string
  emailDate:        string    // ISO string — source email date
  summary:          KBSummaryResult
}

export async function fanOutToStructuredTables(
  supabase: SupabaseClient,
  params:   FanOutParams,
): Promise<void> {
  const { kbEntryId, projectClusterId, gmailThreadId, emailDate, summary } = params

  // Resolve mentioned persons to team member IDs (one DB call for all names)
  const allMentionedNames = [
    ...summary.mentionedResponsiblePersons,
    ...summary.actionItems.map(a => a.owner_hint).filter(Boolean) as string[],
    ...(summary.blockers ?? []).map(b => b.needs_action_from).filter(Boolean) as string[],
  ]

  const nameToMemberId = allMentionedNames.length
    ? await resolveMentionedNamesToMembers(supabase, allMentionedNames)
    : new Map<string, string>()

  // Clear existing items for this KB entry to prevent duplicates or stale records during updates
  await supabase
    .from('project_operational_items')
    .delete()
    .eq('source_kb_entry_id', kbEntryId)

  const rowsToInsert: any[] = []

  // ── 1. Action Items ────────────────────────────────────────────────────────
  for (const item of summary.actionItems) {
    const owner = item.owner_hint ?? null
    const assignedMemberId = owner ? (nameToMemberId.get(owner) ?? null) : null
    rowsToInsert.push({
      source_kb_entry_id: kbEntryId,
      project_cluster_id: projectClusterId,
      gmail_thread_id:    gmailThreadId,
      category:           'action_item',
      description:        item.task,
      owner_hint:         owner,
      assigned_member_id: assignedMemberId,
      due_date:           parseDueDate(item.due_date_hint),
      status:             'open',
      priority:           validatePriority(item.priority),
      source_date:        emailDate,
      metadata:           {}
    })
  }

  // ── 2. Blockers ────────────────────────────────────────────────────────────
  for (const blocker of (summary.blockers ?? [])) {
    const owner = blocker.needs_action_from ?? null
    const assignedMemberId = owner ? (nameToMemberId.get(owner) ?? null) : null
    rowsToInsert.push({
      source_kb_entry_id: kbEntryId,
      project_cluster_id: projectClusterId,
      gmail_thread_id:    gmailThreadId,
      category:           'blocker',
      description:        blocker.description,
      owner_hint:         owner,
      assigned_member_id: assignedMemberId,
      due_date:           null,
      status:             'open',
      priority:           'high',
      source_date:        emailDate,
      metadata:           { blocking_whom: blocker.blocking_whom ?? '' }
    })
  }

  // ── 3. Follow-up (Awaiting Response) ───────────────────────────────────────
  if (summary.awaitingResponseFrom) {
    rowsToInsert.push({
      source_kb_entry_id: kbEntryId,
      project_cluster_id: projectClusterId,
      gmail_thread_id:    gmailThreadId,
      category:           'follow_up',
      description:        `Awaiting response from: ${summary.awaitingResponseFrom}`,
      owner_hint:         summary.awaitingResponseFrom,
      assigned_member_id: null,
      due_date:           null,
      status:             'pending',
      priority:           'medium',
      source_date:        emailDate,
      metadata:           {}
    })
  }

  // ── 4. Decisions ───────────────────────────────────────────────────────────
  for (const decision of (summary.decisionsMade ?? [])) {
    rowsToInsert.push({
      source_kb_entry_id: kbEntryId,
      project_cluster_id: projectClusterId,
      gmail_thread_id:    gmailThreadId,
      category:           'decision',
      description:        decision,
      owner_hint:         null,
      assigned_member_id: null,
      due_date:           null,
      status:             'completed',
      priority:           'medium',
      source_date:        emailDate,
      metadata:           {}
    })
  }

  if (rowsToInsert.length > 0) {
    const { error } = await supabase
      .from('project_operational_items')
      .insert(rowsToInsert)

    if (error) {
      console.error('[Structured Fanout] Error inserting operational items:', error)
      throw error
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDueDate(hint: string | null | undefined): string | null {
  if (!hint) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(hint)
    ? hint
    : (() => {
        try {
          const d = new Date(hint)
          return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
        } catch { return null }
      })()
  return iso
}

function validatePriority(p: string | undefined): 'high' | 'medium' | 'low' {
  if (p === 'high' || p === 'medium' || p === 'low') return p
  return 'medium'
}
