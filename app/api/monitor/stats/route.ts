import { NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'

export async function GET(): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (member.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = getServiceSupabase()

  const [membersRes, streamsRes] = await Promise.all([
    supabase
      .from('member_response_stats')
      .select('*')
      .order('overdue_count', { ascending: false })
      .order('avg_response_minutes', { ascending: false, nullsFirst: false }),
    supabase
      .from('stream_stats')
      .select('*'),
  ])

  const members = (membersRes.data ?? []) as any[]
  const streams = (streamsRes.data ?? []) as any[]

  const totalEmails   = members.reduce((s, m) => s + (m.emails_today ?? 0), 0)
  const repliedOnTime = members.reduce(
    (s, m) => s + Math.round((m.replied_count ?? 0) * ((m.on_time_pct ?? 0) / 100)), 0
  )
  const atRisk      = members.reduce((s, m) => s + (m.pending_count ?? 0), 0)
  const overdueCount = members.reduce((s, m) => s + (m.overdue_count ?? 0), 0)

  return NextResponse.json({
    members,
    streams,
    summary: { totalEmails, repliedOnTime, atRisk, overdueCount },
  })
}
