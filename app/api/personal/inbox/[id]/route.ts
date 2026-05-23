import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'

type RouteContext = { params: Promise<{ id: string }> }

// ── PATCH — mark as read / update is_actionable ───────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params

  const member = await getMemberFromSession()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { is_read, is_actionable } = body as {
    is_read?: boolean
    is_actionable?: boolean
  }

  if (is_read === undefined && is_actionable === undefined) {
    return NextResponse.json(
      { error: 'Provide at least one field: is_read or is_actionable' },
      { status: 400 },
    )
  }

  const updates: Record<string, boolean> = {}
  if (is_read !== undefined)       updates.is_read       = is_read
  if (is_actionable !== undefined) updates.is_actionable = is_actionable

  const supabase = getServiceSupabase()

  // Ownership check embedded in the UPDATE filter — no extra round-trip needed
  const { data, error } = await supabase
    .from('personal_inbox_emails')
    .update(updates)
    .eq('id', id)
    .eq('member_id', member.id)
    .gt('expires_at', new Date().toISOString())
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  }

  return NextResponse.json({ email: data })
}

// ── DELETE — soft-delete by moving expires_at to the past ────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params

  const member = await getMemberFromSession()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceSupabase()

  // Set expires_at one second in the past so cleanup jobs pick it up
  const expiredAt = new Date(Date.now() - 1000).toISOString()

  const { data, error } = await supabase
    .from('personal_inbox_emails')
    .update({ expires_at: expiredAt })
    .eq('id', id)
    .eq('member_id', member.id)
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
