import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, getServiceSupabase } from '@/lib/auth'
import { runKBSync } from '@/lib/kb/run-sync'
import { fetchRecentThreadIds } from '@/lib/gmail/thread'
import { safeDecrypt } from '@/lib/crypto'
import { queuePendingThreads, drainQueueBatch } from '@/lib/kb/queue'
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

  // 1. If not bootstrap, keep the fast incremental path (non-queue)
  if (!bootstrap) {
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (payload: SyncProgressUpdate | Record<string, unknown>) => {
          controller.enqueue(enc.encode(JSON.stringify(payload) + '\n'))
        }
        try {
          const result = await runKBSync({
            bootstrap: false,
            daysBack,
            maxThreadsPerMember: maxThreads > 0 ? maxThreads : 200,
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

  // 2. Bootstrap Path (Queue based)
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload: any) => {
        controller.enqueue(enc.encode(JSON.stringify(payload) + '\n'))
      }

      try {
        const supabase = getServiceSupabase()

        // Get active consented members
        const { data: members } = await supabase
          .from('team_members')
          .select('id, email')
          .eq('is_active', true)
          .eq('consent_given', true)

        if (!members || members.length === 0) {
          emit({
            type: 'done',
            ok: true,
            mode: `bootstrap_queue_${daysBack}d`,
            membersProcessed: 0,
            totalEmailsProcessed: 0,
            totalKBEntriesAdded: 0,
            totalPersonalAdded: 0,
            totalSkipped: 0,
            errors: []
          })
          controller.close()
          return
        }

        const maxThreadsPerMember = maxThreads > 0 ? maxThreads : (daysBack > 100 ? 5000 : 2000)
        let totalQueuedThreads = 0

        // Phase 2a: Retrieve thread IDs and queue them
        for (const memberRow of members) {
          const { data: tokenRow } = await supabase
            .from('member_gmail_tokens')
            .select('access_token, refresh_token')
            .eq('member_id', memberRow.id)
            .single()

          if (!tokenRow?.access_token) continue

          const accessToken  = safeDecrypt(tokenRow.access_token)
          const refreshToken = tokenRow.refresh_token ? safeDecrypt(tokenRow.refresh_token) : undefined

          emit({ type: 'member_start', memberEmail: memberRow.email, totalThreads: 0 })

          const threadIds = await fetchRecentThreadIds(
            accessToken,
            daysBack,
            refreshToken,
            maxThreadsPerMember
          )

          if (threadIds.length > 0) {
            await queuePendingThreads(supabase, memberRow.id, threadIds)
            totalQueuedThreads += threadIds.length

            // Create/Insert a running kb_sync_job row for this member
            await supabase
              .from('kb_sync_jobs')
              .insert({
                member_id:        memberRow.id,
                status:           'running',
                emails_processed: 0,
                emails_skipped:   0,
                kb_entries_added: 0,
                errors:           [],
                started_at:       new Date().toISOString()
              })
          }

          emit({ type: 'thread', memberEmail: memberRow.email, threadsProcessed: 0, totalThreads: threadIds.length })
        }

        // Phase 2b: Process a small initial batch inline (e.g. 10 threads) for immediate feedback
        let inlineProcessed = 0
        let inlineKBEntries = 0
        let inlinePersonal  = 0
        let inlineSkipped   = 0
        const inlineErrors: string[] = []

        if (totalQueuedThreads > 0) {
          const stats = await drainQueueBatch(supabase, 10, (progressUpdate) => {
            // Forward inline thread processing progress to client stream
            if (progressUpdate.type === 'thread') {
              emit(progressUpdate)
            }
          })
          inlineProcessed = stats.processed
          inlineKBEntries = stats.succeeded // approximated
          inlineErrors.push(...stats.errors)
        }

        // Complete the stream, notifying the client that remainder will process in the background
        emit({
          type: 'done',
          ok: true,
          mode: 'queued_background',
          totalQueued: totalQueuedThreads,
          totalEmailsProcessed: inlineProcessed,
          totalKBEntriesAdded: inlineKBEntries,
          totalPersonalAdded: inlinePersonal,
          totalSkipped: inlineSkipped,
          errors: inlineErrors
        })

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
