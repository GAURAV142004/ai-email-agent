import { NextRequest, NextResponse } from 'next/server'
import { runKBSync } from '@/lib/kb/run-sync'

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
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
