import { SupabaseClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MemberInfo {
  id:   string
  name: string
  role: string
}

// ── Resolve email addresses to team member IDs ────────────────────────────────
// Given a list of email addresses (from To:/CC: headers), returns the subset
// that belong to team members, as an array of member UUIDs.

export async function resolveEmailsToMemberIds(
  supabase: SupabaseClient,
  emails:   string[],
): Promise<string[]> {
  if (!emails.length) return []

  const normalised = emails.map(e => e.toLowerCase().trim())

  const { data } = await supabase
    .from('team_members')
    .select('id')
    .in('email', normalised)
    .eq('is_active', true)

  return (data ?? []).map((row: { id: string }) => row.id)
}

// ── Resolve mentioned names to team member IDs ────────────────────────────────
// The AI extracts names like ["Rahul", "Priya Sharma"] from the email body.
// We try to match each against team_members.name (case-insensitive, partial).
// Returns a Map<mentionedName → memberId> for names that matched.

export async function resolveMentionedNamesToMembers(
  supabase:        SupabaseClient,
  mentionedNames:  string[],
  memberCache?:    Map<string, MemberInfo>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (!mentionedNames.length) return result

  // Load all active team members (small table; fine to fetch in full)
  let members: MemberInfo[]
  if (memberCache?.size) {
    members = Array.from(memberCache.values())
  } else {
    const { data } = await supabase
      .from('team_members')
      .select('id, name, role')
      .eq('is_active', true)
    members = (data ?? []) as MemberInfo[]
  }

  for (const mention of mentionedNames) {
    const clean = mention.trim().toLowerCase()
    if (clean.length < 3) continue   // skip initials / very short names

    // Find the best matching team member
    let bestMatch: MemberInfo | null = null
    let bestScore = 0

    for (const member of members) {
      const memberName = member.name.toLowerCase()
      // Full name exact match → highest priority
      if (memberName === clean) {
        bestMatch = member
        bestScore = 999
        break
      }
      // Mentioned name is a substring of member's full name (e.g. "Rahul" in "Rahul Pawar")
      if (memberName.includes(clean) && clean.length > bestScore) {
        bestMatch = member
        bestScore = clean.length
      }
      // Member's first name matches the mention exactly
      const firstName = memberName.split(' ')[0]
      if (firstName === clean && clean.length > bestScore) {
        bestMatch = member
        bestScore = clean.length
      }
    }

    // Only accept if the matched word is at least 4 chars (avoid matching "Dev", "BA" etc.)
    if (bestMatch && bestScore >= 4) {
      result.set(mention, bestMatch.id)
    }
  }

  return result
}

// ── Determine the primary owner of a thread ───────────────────────────────────
// Owner = the team member who appears in the "To" field of the email.
// If none of the To recipients is a team member, fall back to the syncing member.
// This is used to set owner_member_id on the KB entry.

export async function resolveThreadOwner(
  supabase:         SupabaseClient,
  toEmails:         string[],
  fallbackMemberId: string,
): Promise<string> {
  if (!toEmails.length) return fallbackMemberId

  const { data } = await supabase
    .from('team_members')
    .select('id')
    .in('email', toEmails.map(e => e.toLowerCase()))
    .eq('is_active', true)
    .limit(1)
    .single()

  return data?.id ?? fallbackMemberId
}
