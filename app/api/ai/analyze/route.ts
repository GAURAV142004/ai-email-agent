import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { analyzeEmailThread, generateFollowUpDraft } from '@/lib/ai/analyze'
import { z } from 'zod'

const analyzeSchema = z.object({
  action: z.literal('analyze'),
  threadContent: z.string().min(1),
  subject: z.string(),
})

const followUpSchema = z.object({
  action: z.literal('followup'),
  subject: z.string(),
  threadContent: z.string().min(1),
  taskDescription: z.string().min(1),
})

const bodySchema = z.discriminatedUnion('action', [analyzeSchema, followUpSchema])

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  try {
    if (parsed.data.action === 'analyze') {
      const result = await analyzeEmailThread(parsed.data.threadContent, parsed.data.subject)
      return NextResponse.json({ result })
    }

    const draft = await generateFollowUpDraft(
      parsed.data.threadContent,
      parsed.data.subject,
      parsed.data.taskDescription
    )
    return NextResponse.json({ draft })
  } catch (err) {
    console.error('AI analyze error:', err)
    return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 })
  }
}
