import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import type { TodoStatus, TodoPriority } from '@/lib/supabase/types'

type RouteContext = { params: Promise<{ id: string }> }

// ── PATCH — update a todo ─────────────────────────────────────────────────────
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

  const { title, notes, status, priority, due_date } = body as {
    title?:    string
    notes?:    string | null
    status?:   TodoStatus
    priority?: TodoPriority
    due_date?: string
  }

  // Validate status if provided
  const VALID_STATUSES: TodoStatus[] = ['pending', 'in_progress', 'completed', 'deferred']
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  // Validate priority if provided
  const VALID_PRIORITIES: TodoPriority[] = ['high', 'medium', 'low']
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json(
      { error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` },
      { status: 400 },
    )
  }

  // Validate title if provided
  if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
    return NextResponse.json({ error: 'title must not be empty' }, { status: 400 })
  }

  // Build update payload — only include fields that were actually supplied
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (title    !== undefined) updates.title    = title.trim()
  if (notes    !== undefined) updates.notes    = notes
  if (status   !== undefined) updates.status   = status
  if (priority !== undefined) updates.priority = priority
  if (due_date !== undefined) updates.due_date = due_date

  const supabase = getServiceSupabase()

  const { data, error } = await supabase
    .from('daily_todos')
    .update(updates)
    .eq('id', id)
    .eq('member_id', member.id)
    .select(`
      *,
      personal_inbox_emails (
        id,
        subject,
        snippet,
        from_email,
        from_name,
        received_at
      )
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
  }

  return NextResponse.json({ todo: data })
}

// ── DELETE — permanently delete a todo ───────────────────────────────────────
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

  // Ownership is enforced by the member_id filter on the DELETE
  const { error, count } = await supabase
    .from('daily_todos')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('member_id', member.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (count === 0) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
