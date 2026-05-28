import { SupabaseClient } from '@supabase/supabase-js'
import { getServiceSupabase } from '@/lib/auth'
import { fetchThread } from '@/lib/gmail/thread'
import { indexEmailToKB } from './indexer'
import { safeDecrypt } from '@/lib/crypto'
import type { EmailClassificationRule } from '@/lib/supabase/types'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return match ? match[1].toLowerCase() : from.toLowerCase().trim()
}

function extractFromName(from: string): string {
  return from.replace(/<.+?>/, '').trim().replace(/^"|"$/g, '') || ''
}

export interface QueueProgressUpdate {
  type:               'member_start' | 'thread' | 'member_done' | 'done' | 'queued' | 'queued_background'
  memberEmail?:       string
  totalThreads?:      number
  threadsProcessed?:  number
  kbIndexed?:         number
  attachmentsIndexed?: number
  personalAdded?:     number
  skipped?:           number
  errorsCount?:       number
  remaining?:         number
  message?:           string
}

/**
 * Inserts list of thread IDs into the bootstrap queue for a given team member.
 */
export async function queuePendingThreads(
  supabase: SupabaseClient,
  memberId: string,
  threadIds: string[]
): Promise<void> {
  if (!threadIds.length) return

  const rows = threadIds.map(threadId => ({
    member_id:       memberId,
    gmail_thread_id: threadId,
    status:          'pending',
    attempts:        0,
    created_at:      new Date().toISOString(),
    updated_at:      new Date().toISOString()
  }))

  // Upsert to avoid issues if any threads are already queued
  const { error } = await supabase
    .from('kb_bootstrap_queue')
    .upsert(rows, { onConflict: 'member_id,gmail_thread_id' })

  if (error) {
    console.error('[Queue] Error queueing threads:', error)
    throw error
  }
}

/**
 * Claims and processes a batch of queued threads.
 */
export async function drainQueueBatch(
  supabase: SupabaseClient,
  batchSize: number = 30,
  onProgress?: (update: QueueProgressUpdate) => void
): Promise<{ processed: number; succeeded: number; failed: number; errors: string[] }> {
  
  const emit = (update: QueueProgressUpdate) => {
    try { onProgress?.(update) } catch {}
  }

  // 1. Claim a batch of pending threads atomically
  const { data: claimed, error: claimError } = await supabase
    .rpc('claim_bootstrap_queue_batch', { p_batch_size: batchSize })

  if (claimError) {
    console.error('[Queue] Error claiming batch:', claimError)
    return { processed: 0, succeeded: 0, failed: 0, errors: [claimError.message] }
  }

  if (!claimed || claimed.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, errors: [] }
  }

  // 2. Load and decrypt tokens for members referenced in this batch
  const uniqueMemberIds = Array.from(new Set(claimed.map((c: any) => c.member_id))) as string[]
  
  const { data: membersData } = await supabase
    .from('team_members')
    .select('id, email')
    .in('id', uniqueMemberIds)

  const { data: tokensData } = await supabase
    .from('member_gmail_tokens')
    .select('member_id, access_token, refresh_token')
    .in('member_id', uniqueMemberIds)

  const memberMap = new Map<string, { email: string; accessToken: string; refreshToken?: string }>()
  
  for (const m of (membersData ?? [])) {
    const tRow = (tokensData ?? []).find(t => t.member_id === m.id)
    if (tRow?.access_token) {
      memberMap.set(m.id, {
        email:        m.email,
        accessToken:  safeDecrypt(tRow.access_token),
        refreshToken: tRow.refresh_token ? safeDecrypt(tRow.refresh_token) : undefined
      })
    }
  }

  // 3. Load active classification rules
  const { data: rulesData } = await supabase
    .from('email_classification_rules')
    .select('*')
    .eq('is_active', true)

  const rules: EmailClassificationRule[] = (rulesData as EmailClassificationRule[]) ?? []

  let processed = 0
  let succeeded = 0
  let failed    = 0
  const errors: string[] = []

  // Track progress counters per member
  const memberCounters = new Map<string, {
    totalThreads:     number
    threadsProcessed: number
    kbIndexed:        number
    personalAdded:    number
    skipped:          number
    errorsCount:      number
  }>()

  // Initialize counters
  for (const item of claimed) {
    const m = memberMap.get(item.member_id)
    if (m && !memberCounters.has(item.member_id)) {
      const { count } = await supabase
        .from('kb_bootstrap_queue')
        .select('*', { count: 'exact', head: true })
        .eq('member_id', item.member_id)
        .eq('status', 'processing')
      
      memberCounters.set(item.member_id, {
        totalThreads:     count ?? 0,
        threadsProcessed: 0,
        kbIndexed:        0,
        personalAdded:    0,
        skipped:          0,
        errorsCount:      0
      })
      emit({ type: 'member_start', memberEmail: m.email, totalThreads: count ?? 0 })
    }
  }

  // 4. Process each thread
  for (const item of claimed) {
    const memberId = item.member_id
    const threadId = item.gmail_thread_id
    const m = memberMap.get(memberId)
    const stats = memberCounters.get(memberId)

    if (!m) {
      const errMsg = `No Gmail tokens found for member ID ${memberId}`
      await supabase
        .from('kb_bootstrap_queue')
        .update({ status: 'failed', error_message: errMsg, updated_at: new Date().toISOString() })
        .eq('id', item.id)
      failed++
      processed++
      errors.push(errMsg)
      continue
    }

    try {
      // Fetch thread from Gmail
      const thread = await fetchThread(threadId, m.accessToken, m.refreshToken)

      if (!thread.messages.length) {
        await supabase
          .from('kb_bootstrap_queue')
          .update({ status: 'completed', error_message: 'Empty thread', updated_at: new Date().toISOString() })
          .eq('id', item.id)
        succeeded++
        processed++
        if (stats) {
          stats.threadsProcessed++
          stats.skipped++
          emit({ type: 'thread', memberEmail: m.email, ...stats })
        }
        continue
      }

      const rawFrom    = thread.messages[0]?.from ?? ''
      const fromEmail  = extractEmailAddress(rawFrom) || thread.fromEmail
      const fromName   = extractFromName(rawFrom)
      const firstMsgId = thread.messages[0]?.messageId ?? ''

      let kbIndexed = false
      let kbMerged  = false

      // PATH A: KB indexing
      try {
        const kbResult = await indexEmailToKB(supabase, rules, {
          memberId,
          gmailThreadId:  threadId,
          gmailMessageId: firstMsgId,
          fromEmail,
          toEmail:        m.email,
          toEmails:       thread.toEmails,
          ccEmails:       thread.ccEmails,
          subject:        thread.subject,
          threadText:     thread.fullText,
          snippet:        thread.fullText.slice(0, 500),
          emailDate:      thread.receivedAt,
          direction:      'inbound',
          attachments:    thread.attachments,
          accessToken:    m.accessToken,
          refreshToken:   m.refreshToken,
        })
        kbIndexed = kbResult.indexed
        kbMerged  = !!kbResult.merged
      } catch (kbErr: any) {
        console.error(`[Queue] KB indexing error for thread ${threadId}:`, kbErr)
        errors.push(`KB ${threadId}: ${kbErr?.message ?? 'unknown'}`)
      }

      // Path B (Personal Inbox) omitted to focus exclusively on Plan A (Global Knowledge Base)
      const personalAdded = false

      // Update queue item to completed
      await supabase
        .from('kb_bootstrap_queue')
        .update({ status: 'completed', error_message: null, updated_at: new Date().toISOString() })
        .eq('id', item.id)

      succeeded++
      processed++

      if (stats) {
        stats.threadsProcessed++
        if (kbIndexed) stats.kbIndexed++
        if (personalAdded) stats.personalAdded++
        if (!kbIndexed && !kbMerged && !personalAdded) stats.skipped++
        emit({ type: 'thread', memberEmail: m.email, ...stats })
      }

      // Sleep briefly to avoid API rate limits
      await sleep(150)
    } catch (err: any) {
      console.error(`[Queue] Error processing thread ${threadId}:`, err)
      const errorMsg = err?.message ?? 'unknown error'
      await supabase
        .from('kb_bootstrap_queue')
        .update({ status: 'failed', error_message: errorMsg, updated_at: new Date().toISOString() })
        .eq('id', item.id)
      
      failed++
      processed++
      errors.push(`Thread ${threadId}: ${errorMsg}`)

      if (stats) {
        stats.threadsProcessed++
        stats.errorsCount++
        emit({ type: 'thread', memberEmail: m.email, ...stats })
      }
    }
  }

  // 5. Update sync jobs and emit member_done for each member present
  for (const memberId of uniqueMemberIds) {
    const m = memberMap.get(memberId)
    const stats = memberCounters.get(memberId)
    if (m && stats) {
      // Find the active running job for this member
      const { data: activeJob } = await supabase
        .from('kb_sync_jobs')
        .select('id, emails_processed, emails_skipped, kb_entries_added, errors')
        .eq('member_id', memberId)
        .eq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (activeJob) {
        // Collect errors from this batch
        const nextErrors = [...(activeJob.errors ?? []), ...errors].slice(0, 100)
        
        await supabase
          .from('kb_sync_jobs')
          .update({
            emails_processed: activeJob.emails_processed + stats.threadsProcessed,
            emails_skipped:   activeJob.emails_skipped + stats.skipped,
            kb_entries_added: activeJob.kb_entries_added + stats.kbIndexed,
            errors:           nextErrors,
          })
          .eq('id', activeJob.id)

        // Check if there are any remaining pending/processing items in the queue for this member
        const { count: remainingCount } = await supabase
          .from('kb_bootstrap_queue')
          .select('*', { count: 'exact', head: true })
          .eq('member_id', memberId)
          .in('status', ['pending', 'processing'])

        if (remainingCount === 0) {
          // Queue is completely empty for this member! Mark job as completed.
          await supabase
            .from('kb_sync_jobs')
            .update({
              status:       'completed',
              completed_at: new Date().toISOString()
            })
            .eq('id', activeJob.id)
        }
      }

      emit({ type: 'member_done', memberEmail: m.email })
    }
  }

  return { processed, succeeded, failed, errors }
}
