import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = getServiceSupabase()

  const { data: conv } = await supabase
    .from('agent_conversations')
    .select('*')
    .eq('id', id)
    .single()

  if (!conv || conv.member_id !== member.id)
    return NextResponse.json({ error: 'Not found' }, { status: 403 })

  const { data: messages } = await supabase
    .from('agent_messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ conversation: conv, messages: messages ?? [] })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = getServiceSupabase()

  const { data: conv } = await supabase
    .from('agent_conversations')
    .select('member_id')
    .eq('id', id)
    .single()

  if (!conv || conv.member_id !== member.id)
    return NextResponse.json({ error: 'Not found' }, { status: 403 })

  await supabase.from('agent_conversations').delete().eq('id', id)

  return NextResponse.json({ success: true })
}
