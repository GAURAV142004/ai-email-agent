import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import type { TodoStatus, TodoPriority, DailyTodoStats } from '@/lib/supabase/types'

// Priority order for sorting: high → medium → low
const PRIORITY_ORDER: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 }

// ── GET — list todos for the authenticated member ─────────────────────────────
export async function GET(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const date   = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const status = searchParams.get('status') as TodoStatus | null

  const VALID_STATUSES: TodoStatus[] = ['pending', 'in_progress', 'completed', 'deferred']
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  const supabase = getServiceSupabase()

  let query = supabase
    .from('daily_todos')
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
    .eq('member_id', member.id)
    .eq('due_date', date)

  if (status) {
    query = query.eq('status', status)
  }

  const { data: todos, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Sort in-memory: priority DESC (high first), then created_at ASC
  const sorted = (todos ?? []).sort((a, b) => {
    const priorityDiff =
      PRIORITY_ORDER[a.priority as TodoPriority] -
      PRIORITY_ORDER[b.priority as TodoPriority]
    if (priorityDiff !== 0) return priorityDiff
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  // Stats over all todos for that day (ignoring status filter)
  const { data: allTodos, error: statsError } = await supabase
    .from('daily_todos')
    .select('status')
    .eq('member_id', member.id)
    .eq('due_date', date)

  if (statsError) {
    return NextResponse.json({ error: statsError.message }, { status: 500 })
  }

  const stats: DailyTodoStats = (allTodos ?? []).reduce(
    (acc, row) => {
      acc.total++
      if (row.status === 'pending')     acc.pending++
      if (row.status === 'in_progress') acc.inProgress++
      if (row.status === 'completed')   acc.completed++
      if (row.status === 'deferred')    acc.deferred++
      return acc
    },
    { total: 0, pending: 0, inProgress: 0, completed: 0, deferred: 0 } as DailyTodoStats,
  )

  return NextResponse.json({ todos: sorted, stats })
}

// ── POST — create a new todo ──────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
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

  const {
    title,
    notes,
    priority = 'medium',
    due_date,
    linked_email_id,
  } = body as {
    title?: string
    notes?: string
    priority?: TodoPriority
    due_date?: string
    linked_email_id?: string
  }

  if (!title || typeof title !== 'string' || title.trim() === '') {
    return NextResponse.json({ error: 'title is required and must not be empty' }, { status: 400 })
  }

  const VALID_PRIORITIES: TodoPriority[] = ['high', 'medium', 'low']
  if (!VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json(
      { error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` },
      { status: 400 },
    )
  }

  const today = new Date().toISOString().slice(0, 10)

  const supabase = getServiceSupabase()

  // If a linked_email_id is provided, verify it belongs to this member
  if (linked_email_id) {
    const { data: emailCheck, error: emailError } = await supabase
      .from('personal_inbox_emails')
      .select('id')
      .eq('id', linked_email_id)
      .eq('member_id', member.id)
      .single()

    if (emailError || !emailCheck) {
      return NextResponse.json(
        { error: 'linked_email_id not found or does not belong to you' },
        { status: 400 },
      )
    }
  }

  const { data, error } = await supabase
    .from('daily_todos')
    .insert({
      member_id:       member.id,
      title:           title.trim(),
      notes:           notes ?? null,
      priority,
      status:          'pending' as TodoStatus,
      due_date:        due_date ?? today,
      linked_email_id: linked_email_id ?? null,
    })
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

  return NextResponse.json({ todo: data }, { status: 201 })
}
