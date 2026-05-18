import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { canView, type TeamRole } from '@/lib/roles'
import { generateFollowUpDraft } from '@/lib/ai/analyze'

// Simple in-memory rate limit: 10 draft requests per member per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(memberId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(memberId)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(memberId, { count: 1, resetAt: now + 60_000 })
    return true
  }

  if (entry.count >= 10) return false

  entry.count++
  return true
}

const DraftSchema = z.object({
  threadDbId:      z.string().uuid(),
  taskDescription: z.string().min(1),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!checkRateLimit(member.id)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a minute.' },
      { status: 429 }
    )
  }

  const body = await request.json()
  const parsed = DraftSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  const { threadDbId, taskDescription } = parsed.data
  const supabase = getServiceSupabase()

  const { data: thread, error: threadError } = await supabase
    .from('email_threads')
    .select('id, subject, summary, owner_member_id, owner:team_members!owner_member_id(role)')
    .eq('id', threadDbId)
    .single()

  if (threadError || !thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }

  const ownerRole = (thread as any).owner?.role as TeamRole
  if (!canView(member.role, ownerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const threadContext = (thread as any).summary ?? ''
  const draft = await generateFollowUpDraft(
    threadContext,
    (thread as any).subject ?? '',
    taskDescription
  )

  return NextResponse.json({ draft: draft.body })
}
