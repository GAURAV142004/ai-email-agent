import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'

const patchSchema = z.object({
  name:      z.string().min(2).optional(),
  role:      z.enum([
    'delivery_lead', 'senior_ba', 'senior_mis', 'senior_developer',
    'ba', 'mis', 'developer',
  ]).optional(),
  is_active: z.boolean().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (member.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  if (id === member.id && parsed.data.role !== undefined) {
    return NextResponse.json({ error: 'Cannot change your own role' }, { status: 403 })
  }

  const supabase = getServiceSupabase()

  const { data: updated, error } = await supabase
    .from('team_members')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ member: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (member.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  if (id === member.id) {
    return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 403 })
  }

  const supabase = getServiceSupabase()

  // Check if member has KB entries — soft-delete instead of hard-delete
  const { count } = await supabase
    .from('email_knowledge_base')
    .select('id', { count: 'exact', head: true })
    .eq('owner_member_id', id)

  if ((count ?? 0) > 0) {
    await supabase
      .from('team_members')
      .update({ is_active: false })
      .eq('id', id)

    return NextResponse.json({ deactivated: true, reason: 'Member has KB history' })
  }

  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
