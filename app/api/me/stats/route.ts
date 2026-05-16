import { NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'

export async function GET(): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()

  const { data: stats } = await supabase
    .from('member_response_stats')
    .select('*')
    .eq('id', member.id)
    .single()

  // Reply source breakdown this week
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: weekMessages } = await supabase
    .from('email_thread_messages')
    .select('source, response_minutes, sent_at')
    .eq('owner_member_id', member.id)
    .eq('direction', 'outbound')
    .gte('sent_at', weekAgo)

  const appReplies   = weekMessages?.filter(m => m.source === 'app').length ?? 0
  const gmailReplies = weekMessages?.filter(m => m.source === 'gmail').length ?? 0
  const avgThisWeek  = weekMessages?.length
    ? Math.round(
        weekMessages.reduce((s, m) => s + (m.response_minutes ?? 0), 0) / weekMessages.length
      )
    : null

  return NextResponse.json({
    stats: stats ?? {},
    thisWeek: { appReplies, gmailReplies, avgThisWeek },
  })
}
