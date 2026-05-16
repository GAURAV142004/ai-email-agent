import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, getServiceSupabase } from '@/lib/auth'
import { z } from 'zod'

const createTaskSchema = z.object({
  task: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  due_date: z.string().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
})

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const priority = searchParams.get('priority')
  const limit = parseInt(searchParams.get('limit') ?? '50')

  const supabase = getServiceSupabase()

  let query = supabase
    .from('tasks')
    .select('*, email_threads(subject, from_email, email_link, summary)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)
  if (priority) query = query.eq('priority', priority)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ tasks: data ?? [] })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...parsed.data, user_id: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ task: data }, { status: 201 })
}
