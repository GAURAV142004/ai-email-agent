import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runKBSync } from '@/lib/kb/run-sync'
import type { SyncProgressUpdate } from '@/lib/kb/run-sync'

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const member = session.user as any
  if (member?.role !== 'delivery_lead') {
    return new Response(JSON.stringify({ error: 'Forbidden — delivery_lead only' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const url        = new URL(request.url)
  const bootstrap  = url.searchParams.get('bootstrap') === 'true'
  const daysBack   = parseInt(url.searchParams.get('days') ?? '30', 10)
  const maxThreads = parseInt(url.searchParams.get('maxThreads') ?? '0', 10)

  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload: SyncProgressUpdate | Record<string, unknown>) => {
        controller.enqueue(enc.encode(JSON.stringify(payload) + '\n'))
      }

      try {
        const result = await runKBSync({
          bootstrap,
          daysBack,
          maxThreadsPerMember: maxThreads > 0 ? maxThreads : bootstrap ? 500 : 200,
          onProgress: emit,
        })
        emit({ type: 'done', ...result })
      } catch (err: any) {
        emit({ type: 'error', error: err?.message ?? 'Unknown error' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':    'application/x-ndjson',
      'Cache-Control':   'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
