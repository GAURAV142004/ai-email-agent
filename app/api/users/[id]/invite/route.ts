import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { ROLE_LABELS, type TeamRole } from '@/lib/roles'
import { sendInviteEmail } from '@/lib/email/sender'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (member.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const supabase = getServiceSupabase()

  const { data: target } = await supabase
    .from('team_members')
    .select('id, name, email, role')
    .eq('id', id)
    .single()

  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const result = await sendInviteEmail({
    toEmail:       target.email,
    toName:        target.name,
    invitedByName: member.name ?? member.email,
    role:          ROLE_LABELS[target.role as TeamRole] ?? target.role,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Failed to send email' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
