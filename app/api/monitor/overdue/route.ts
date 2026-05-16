import { NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'

export async function GET(): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (member.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = getServiceSupabase()

  const { data, error } = await supabase
    .from('email_threads')
    .select(`
      id,
      thread_id,
      subject,
      from_email,
      received_at,
      reply_status,
      owner:team_members!owner_member_id ( name, role )
    `)
    .eq('reply_status', 'overdue')
    .order('received_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const threads = (data ?? []).map((row: any) => ({
    id:           row.id,
    thread_id:    row.thread_id,
    subject:      row.subject,
    from_email:   row.from_email,
    received_at:  row.received_at,
    reply_status: row.reply_status,
    owner_name:   row.owner?.name ?? 'Unknown',
    owner_role:   row.owner?.role ?? 'unknown',
  }))

  return NextResponse.json({ threads })
}
