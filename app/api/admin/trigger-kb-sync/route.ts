import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runKBSync } from '@/lib/kb/run-sync'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = session.user as any
  if (member?.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden — delivery_lead only' }, { status: 403 })
  }

  const url       = new URL(request.url)
  const bootstrap = url.searchParams.get('bootstrap') === 'true'
  const daysBack  = parseInt(url.searchParams.get('days') ?? '30', 10)

  // Run sync directly — no internal HTTP call needed
  const result = await runKBSync({
    bootstrap,
    daysBack,
    // Limit threads per member for admin-triggered sync to avoid Vercel timeout
    maxThreadsPerMember: bootstrap ? 30 : 100,
  })

  return NextResponse.json(result)
}
