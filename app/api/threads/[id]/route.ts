import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { canView, type TeamRole } from '@/lib/roles'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = getServiceSupabase()

  const { data: thread } = await supabase
    .from('email_threads')
    .select(`
      *,
      owner:team_members!owner_member_id (
        id, name, email, role, avatar_url
      )
    `)
    .eq('id', id)
    .single()

  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const owner = (thread as any).owner
  const ownerRole = owner?.role as TeamRole | undefined
  if (ownerRole && !canView(member.role, ownerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = {
    ...thread,
    owner_name:         owner?.name         ?? '',
    owner_email:        owner?.email        ?? '',
    owner_role:         ownerRole           ?? '',
    owner_avatar_url:   owner?.avatar_url   ?? null,
    task_count:         0,
    pending_task_count: 0,
    highest_priority:   'medium' as const,
  }

  return NextResponse.json({ thread: result })
}
