import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = session.user as any
  if (member?.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden — delivery_lead only' }, { status: 403 })
  }

  // Forward optional ?bootstrap=true&days=30 params
  const inUrl     = new URL(request.url)
  const bootstrap = inUrl.searchParams.get('bootstrap') ?? 'false'
  const days      = inUrl.searchParams.get('days') ?? '30'

  const base = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const target = new URL('/api/cron/kb-sync', base)
  target.searchParams.set('bootstrap', bootstrap)
  target.searchParams.set('days', days)

  const res = await fetch(target.toString(), {
    method:  'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })

  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
