import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/auth'
import { indexEmailToKB } from '@/lib/kb/indexer'
import { fetchThread, fetchNewMessages } from '@/lib/gmail/thread'
import { safeDecrypt } from '@/lib/crypto'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceSupabase()

  // Load all active consented members
  const { data: members } = await supabase
    .from('team_members')
    .select('id, email, last_history_id')
    .eq('is_active', true)
    .eq('consent_given', true)

  if (!members?.length) {
    return NextResponse.json({ message: 'No eligible members', membersProcessed: 0 })
  }

  // Load all active classification rules once (shared across all members)
  const { data: rules } = await supabase
    .from('email_classification_rules')
    .select('*')
    .eq('is_active', true)

  const classificationRules = rules ?? []

  let totalProcessed  = 0
  let totalKBEntries  = 0
  let totalSkipped    = 0
  let membersProcessed = 0

  for (const member of members) {
    if (!member.last_history_id) {
      // No watch set up yet — skip
      continue
    }

    // Load Gmail tokens
    const { data: tokenRow } = await supabase
      .from('member_gmail_tokens')
      .select('access_token, refresh_token')
      .eq('member_id', member.id)
      .single()

    if (!tokenRow?.access_token) continue

    const accessToken  = safeDecrypt(tokenRow.access_token)
    const refreshToken = tokenRow.refresh_token
      ? safeDecrypt(tokenRow.refresh_token)
      : undefined

    // Create sync job record
    const { data: syncJob } = await supabase
      .from('kb_sync_jobs')
      .insert({
        member_id:  member.id,
        status:     'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    let emailsProcessed = 0
    let kbEntriesAdded  = 0
    let emailsSkipped   = 0
    const errors: string[] = []
    let latestHistoryId = member.last_history_id

    try {
      const threadIds = await fetchNewMessages(
        accessToken,
        member.last_history_id,
        refreshToken,
      )

      for (const threadId of threadIds) {
        try {
          const thread = await fetchThread(threadId, accessToken, refreshToken)

          const result = await indexEmailToKB(supabase, classificationRules, {
            memberId:       member.id,
            gmailThreadId:  thread.threadId,
            gmailMessageId: thread.messages?.[thread.messages.length - 1]?.messageId ?? threadId,
            fromEmail:      thread.fromEmail ?? '',
            toEmail:        member.email,
            subject:        thread.subject ?? '',
            threadText:     thread.fullText ?? '',
            snippet:        (thread.fullText ?? '').slice(0, 500),
            emailDate:      thread.receivedAt ?? new Date().toISOString(),
            direction:      'inbound',
          })

          emailsProcessed++
          if (result.indexed) kbEntriesAdded++
          else emailsSkipped++

          await sleep(150) // rate limit between threads
        } catch (err: any) {
          errors.push(`Thread ${threadId}: ${err?.message ?? 'unknown error'}`)
          emailsSkipped++
        }
      }

      // Advance history cursor after successful processing
      if (threadIds.length > 0) {
        await supabase
          .from('team_members')
          .update({ last_history_id: latestHistoryId })
          .eq('id', member.id)
      }
    } catch (err: any) {
      errors.push(`Member sync failed: ${err?.message ?? 'unknown'}`)
    }

    // Update sync job to completed
    if (syncJob?.id) {
      await supabase
        .from('kb_sync_jobs')
        .update({
          status:           errors.length && emailsProcessed === 0 ? 'failed' : 'completed',
          emails_processed: emailsProcessed,
          emails_skipped:   emailsSkipped,
          kb_entries_added: kbEntriesAdded,
          errors:           errors,
          completed_at:     new Date().toISOString(),
        })
        .eq('id', syncJob.id)
    }

    totalProcessed   += emailsProcessed
    totalKBEntries   += kbEntriesAdded
    totalSkipped     += emailsSkipped
    membersProcessed++

    await sleep(200) // rate limit between members
  }

  return NextResponse.json({
    ok: true,
    membersProcessed,
    totalEmailsProcessed: totalProcessed,
    totalKBEntriesAdded:  totalKBEntries,
    totalSkipped,
  })
}
