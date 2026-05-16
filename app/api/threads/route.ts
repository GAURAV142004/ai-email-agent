import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { isManagerRole, type TeamRole } from '@/lib/roles'
import type { TaskPriority } from '@/lib/supabase/types'

const PRIORITY_ORDER: TaskPriority[] = ['high', 'medium', 'low']

export async function GET(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const memberId    = searchParams.get('memberId')
  const replyStatus = searchParams.get('replyStatus')
  const limit       = Math.min(parseInt(searchParams.get('limit')  ?? '50'), 100)
  const offset      = parseInt(searchParams.get('offset') ?? '0')

  const supabase = getServiceSupabase()

  // Step 1: resolve visible member IDs based on assignments
  let visibleMemberIds: string[] = []

  if (member.role === 'delivery_lead') {
    const { data } = await supabase
      .from('team_members')
      .select('id')
      .eq('is_active', true)
    visibleMemberIds = data?.map(m => m.id) ?? []
  } else if (isManagerRole(member.role as TeamRole)) {
    const { data } = await supabase
      .from('team_member_reports')
      .select('member_id')
      .eq('manager_id', member.id)
    visibleMemberIds = [
      member.id,
      ...(data?.map(r => r.member_id) ?? [])
    ]
  } else {
    visibleMemberIds = [member.id]
  }

  if (visibleMemberIds.length === 0) {
    return NextResponse.json({ threads: [], total: 0, hasMore: false })
  }

  let memberIds = visibleMemberIds
  if (memberId) memberIds = memberIds.filter(id => id === memberId)
  if (memberIds.length === 0) {
    return NextResponse.json({ threads: [], total: 0, hasMore: false })
  }

  // Step 2: fetch member details for response shaping
  const { data: visibleMembers, error: membersError } = await supabase
    .from('team_members')
    .select('id, name, role, email, avatar_url')
    .in('id', memberIds)

  if (membersError) return NextResponse.json({ error: membersError.message }, { status: 500 })

  const memberMap = new Map((visibleMembers ?? []).map(m => [m.id as string, m]))

  // Step 3: query threads + embedded tasks for count/priority
  let query = supabase
    .from('email_threads')
    .select('*, tasks(id, status, priority)', { count: 'exact' })
    .in('owner_member_id', memberIds)
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (replyStatus) query = query.eq('reply_status', replyStatus)

  const { data: rawThreads, count, error: threadsError } = await query

  if (threadsError) return NextResponse.json({ error: threadsError.message }, { status: 500 })

  // Step 4: shape response — merge member info + compute counts
  const threads = (rawThreads ?? []).map((t: any) => {
    const { tasks: rawTasks, ...thread } = t
    const taskList: Array<{ status: string; priority: string }> = rawTasks ?? []
    const owner = memberMap.get(t.owner_member_id) ?? null
    const highestPriority: TaskPriority =
      PRIORITY_ORDER.find(p => taskList.some(task => task.priority === p)) ?? 'low'

    return {
      ...thread,
      owner_name:       owner?.name       ?? '',
      owner_role:       owner?.role       ?? '',
      owner_email:      owner?.email      ?? '',
      owner_avatar_url: owner?.avatar_url ?? null,
      task_count:         taskList.length,
      pending_task_count: taskList.filter(task => task.status === 'pending').length,
      highest_priority:   highestPriority,
    }
  })

  const total = count ?? 0
  return NextResponse.json({ threads, total, hasMore: offset + limit < total })
}
