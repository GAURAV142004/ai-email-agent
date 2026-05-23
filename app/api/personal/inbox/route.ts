import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import type { AIPriority, PersonalEmailStats } from '@/lib/supabase/types'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const unread      = searchParams.get('unread')
  const actionable  = searchParams.get('actionable')
  const priority    = searchParams.get('priority') as AIPriority | null
  const limit       = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)
  const offset      = parseInt(searchParams.get('offset') ?? '0', 10)

  const supabase = getServiceSupabase()

  // ── Main paginated query ──────────────────────────────────────────────────
  let query = supabase
    .from('personal_inbox_emails')
    .select('*', { count: 'exact' })
    .eq('member_id', member.id)
    .gt('expires_at', new Date().toISOString())
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (unread === 'true')       query = query.eq('is_read', false)
  if (actionable === 'true')   query = query.eq('is_actionable', true)
  if (priority && ['high', 'medium', 'low'].includes(priority)) {
    query = query.eq('ai_priority', priority)
  }

  const { data: emails, count, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Stats query (always over the full non-expired set for this member) ────
  const { data: statsRows, error: statsError } = await supabase
    .from('personal_inbox_emails')
    .select('is_read, is_actionable, ai_priority')
    .eq('member_id', member.id)
    .gt('expires_at', new Date().toISOString())

  if (statsError) {
    return NextResponse.json({ error: statsError.message }, { status: 500 })
  }

  const stats: PersonalEmailStats = (statsRows ?? []).reduce(
    (acc, row) => {
      acc.total++
      if (!row.is_read)               acc.unread++
      if (row.is_actionable)          acc.actionable++
      if (row.ai_priority === 'high') acc.highPriority++
      return acc
    },
    { total: 0, unread: 0, actionable: 0, highPriority: 0, replySent: 0 } as PersonalEmailStats,
  )

  return NextResponse.json({
    emails:  emails ?? [],
    total:   count ?? 0,
    stats,
  })
}
