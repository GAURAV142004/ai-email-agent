import { NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'

export async function GET(): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: pending } = await supabase
    .from('email_threads')
    .select('id, subject, from_email, received_at, response_minutes')
    .eq('owner_member_id', member.id)
    .eq('reply_status', 'pending')
    .order('received_at', { ascending: true })

  const { data: overdue } = await supabase
    .from('email_threads')
    .select('id, subject, from_email, received_at')
    .eq('owner_member_id', member.id)
    .eq('reply_status', 'overdue')
    .order('received_at', { ascending: true })

  const todayPending = pending?.filter(t =>
    new Date(t.received_at) >= today
  ) ?? []

  return NextResponse.json({
    pending_count: pending?.length ?? 0,
    overdue_count: overdue?.length ?? 0,
    today_count:   todayPending.length,
    pending:       pending ?? [],
    overdue:       overdue ?? [],
  })
}
