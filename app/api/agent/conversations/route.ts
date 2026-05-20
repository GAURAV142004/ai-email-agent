import { NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'

export async function GET(): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()
  const { data } = await supabase
    .from('agent_conversations')
    .select('id, title, created_at, updated_at')
    .eq('member_id', member.id)
    .order('updated_at', { ascending: false })
    .limit(30)

  return NextResponse.json({ conversations: data ?? [] })
}
