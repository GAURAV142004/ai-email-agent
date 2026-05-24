import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { runKBSync } from '@/lib/kb/run-sync'

function verifyCronSecret(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !authHeader) return false
  const expected = `Bearer ${secret}`
  if (authHeader.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url       = new URL(request.url)
  const bootstrap = url.searchParams.get('bootstrap') === 'true'
  const daysBack  = parseInt(url.searchParams.get('days') ?? '30', 10)

  const result = await runKBSync({ bootstrap, daysBack })
  return NextResponse.json(result)
}

// Vercel cron jobs send GET requests — alias to POST handler
export const GET = POST
