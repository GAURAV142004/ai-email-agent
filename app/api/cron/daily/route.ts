import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { runKBSync } from '@/lib/kb/run-sync'
import { cleanupPersonal, renewWatches } from '@/lib/cron/tasks'

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
  const isDev = process.env.NODE_ENV === 'development'
  const authHeader = request.headers.get('authorization')

  if (!isDev && !verifyCronSecret(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron] Starting unified daily tasks...')
  
  const results: any = {}

  // 1. KB Sync
  try {
    results.kbSync = await runKBSync({ daysBack: 1 })
  } catch (err: any) {
    results.kbSync = { error: err.message }
  }

  // 2. Cleanup
  try {
    results.cleanup = await cleanupPersonal()
  } catch (err: any) {
    results.cleanup = { error: err.message }
  }

  // 3. Renew watches
  try {
    results.renewWatches = await renewWatches()
  } catch (err: any) {
    results.renewWatches = { error: err.message }
  }

  return NextResponse.json({
    ok: true,
    ...results
  })
}

// Vercel cron jobs send GET requests
export const GET = POST
