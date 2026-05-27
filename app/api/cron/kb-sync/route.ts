import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { runKBSync } from '@/lib/kb/run-sync'
import { getServiceSupabase } from '@/lib/auth'
import { drainQueueBatch } from '@/lib/kb/queue'

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
  // Allow bypassing cron secret verification locally for manual testing (when NODE_ENV is development)
  const isDev = process.env.NODE_ENV === 'development'
  const authHeader = request.headers.get('authorization')

  if (!isDev && !verifyCronSecret(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceSupabase()

  // 1. Check if there are any pending or processing threads in the bootstrap queue
  const { count, error } = await supabase
    .from('kb_bootstrap_queue')
    .select('*', { count: 'exact', head: true })
    .in('status', ['pending', 'processing'])

  if (error) {
    console.error('[Cron] Error checking bootstrap queue:', error)
  }

  if (count && count > 0) {
    console.log(`[Cron] Queue contains ${count} pending/processing items. Draining a batch...`)
    
    // Process a safe batch of 30 threads in this execution
    const stats = await drainQueueBatch(supabase, 30)
    
    return NextResponse.json({
      ok: true,
      mode: 'queue_drain',
      queueRemaining: Math.max(0, count - stats.processed),
      ...stats
    })
  }

  // 2. Queue is empty: run standard incremental sync
  const url       = new URL(request.url)
  const bootstrap = url.searchParams.get('bootstrap') === 'true'
  const daysBack  = parseInt(url.searchParams.get('days') ?? '30', 10)

  console.log('[Cron] Queue is empty. Running standard KB sync...')
  const result = await runKBSync({ bootstrap, daysBack })
  return NextResponse.json(result)
}

// Vercel cron jobs send GET requests — alias to POST handler
export const GET = POST
