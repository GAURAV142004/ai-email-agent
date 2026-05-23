import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/auth'
import { indexEmailToKB } from '@/lib/kb/indexer'
import { fetchThread, fetchNewMessages, fetchRecentThreadIds } from '@/lib/gmail/thread'
import { analyzeEmailThread } from '@/lib/ai/analyze'
import { shouldSkipAIAnalysis } from '@/lib/ai/pre-filter'
import { safeDecrypt } from '@/lib/crypto'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return match ? match[1].toLowerCase() : from.toLowerCase().trim()
}

function extractFromName(from: string): string {
  return from.replace(/<.+?>/, '').trim().replace(/^"|"$/g, '') || ''
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?bootstrap=true  → use messages.list for last 30 days instead of history.list
  const url       = new URL(request.url)
  const bootstrap = url.searchParams.get('bootstrap') === 'true'
  const daysBack  = parseInt(url.searchParams.get('days') ?? '30', 10)

  const supabase = getServiceSupabase()

  const { data: members } = await supabase
    .from('team_members')
    .select('id, email, last_history_id')
    .eq('is_active', true)
    .eq('consent_given', true)

  if (!members?.length) {
    return NextResponse.json({ message: 'No eligible members', membersProcessed: 0 })
  }

  const { data: rules } = await supabase
    .from('email_classification_rules')
    .select('*')
    .eq('is_active', true)

  const classificationRules = rules ?? []

  let totalEmailsProcessed = 0
  let totalKBEntries       = 0
  let totalSkipped         = 0
  let totalPersonalAdded   = 0
  let membersProcessed     = 0

  for (const member of members) {
    const { data: tokenRow } = await supabase
      .from('member_gmail_tokens')
      .select('access_token, refresh_token')
      .eq('member_id', member.id)
      .single()

    if (!tokenRow?.access_token) continue

    const accessToken  = safeDecrypt(tokenRow.access_token)
    const refreshToken = tokenRow.refresh_token ? safeDecrypt(tokenRow.refresh_token) : undefined

    const { data: syncJob } = await supabase
      .from('kb_sync_jobs')
      .insert({ member_id: member.id, status: 'running', started_at: new Date().toISOString() })
      .select('id')
      .single()

    let emailsProcessed = 0
    let kbEntriesAdded  = 0
    let emailsSkipped   = 0
    let personalAdded   = 0
    const errors: string[] = []

    try {
      let threadIds: string[]
      let newHistoryId: string | null = null

      if (bootstrap || !member.last_history_id) {
        // Bootstrap: fetch recent emails directly via messages.list
        threadIds = await fetchRecentThreadIds(accessToken, daysBack, refreshToken)
      } else {
        // Incremental: use Gmail History API since last cursor
        const result = await fetchNewMessages(accessToken, member.last_history_id, refreshToken)
        threadIds    = result.threadIds
        newHistoryId = result.newHistoryId
      }

      for (const threadId of threadIds) {
        try {
          const thread = await fetchThread(threadId, accessToken, refreshToken)

          if (!thread.messages.length) { emailsSkipped++; continue }

          const rawFrom    = thread.messages[0]?.from ?? ''
          const fromEmail  = extractEmailAddress(rawFrom) || thread.fromEmail
          const fromName   = extractFromName(rawFrom)
          const firstMsgId = thread.messages[0]?.messageId ?? ''

          // ── PATH A: KB indexing ───────────────────────────────────────────
          try {
            const kbResult = await indexEmailToKB(supabase, classificationRules, {
              memberId:       member.id,
              gmailThreadId:  threadId,
              gmailMessageId: firstMsgId,
              fromEmail,
              toEmail:        member.email,
              subject:        thread.subject,
              threadText:     thread.fullText,
              snippet:        thread.fullText.slice(0, 500),
              emailDate:      thread.receivedAt,
              direction:      'inbound',
            })
            if (kbResult.indexed) kbEntriesAdded++
            else emailsSkipped++
          } catch (kbErr: any) {
            errors.push(`KB thread ${threadId}: ${kbErr?.message ?? 'unknown'}`)
          }

          // ── PATH B: Personal inbox ────────────────────────────────────────
          const { data: existingPersonal } = await supabase
            .from('personal_inbox_emails')
            .select('id')
            .eq('member_id', member.id)
            .eq('gmail_message_id', firstMsgId)
            .maybeSingle()

          if (!existingPersonal) {
            const snippet = thread.fullText.slice(0, 500)
            const preFilter = shouldSkipAIAnalysis(fromEmail, thread.subject, snippet)

            if (!preFilter.skip) {
              try {
                const analysis = await analyzeEmailThread(thread.fullText, thread.subject)
                const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()

                await supabase.from('personal_inbox_emails').insert({
                  member_id:        member.id,
                  gmail_thread_id:  threadId,
                  gmail_message_id: firstMsgId,
                  subject:          thread.subject,
                  from_email:       fromEmail,
                  from_name:        fromName || null,
                  snippet:          snippet || null,
                  received_at:      thread.receivedAt,
                  is_read:          false,
                  ai_summary:       analysis.summary,
                  ai_priority:      analysis.priority,
                  is_actionable:    analysis.requiresAction,
                  reply_sent:       false,
                  expires_at:       expiresAt,
                })
                personalAdded++
              } catch (aiErr: any) {
                errors.push(`Personal inbox thread ${threadId}: ${aiErr?.message ?? 'unknown'}`)
              }
            }
          }

          emailsProcessed++
          await sleep(200)    // avoid Gmail rate limits
        } catch (err: any) {
          errors.push(`Thread ${threadId}: ${err?.message ?? 'unknown error'}`)
          emailsSkipped++
        }
      }

      // Advance history cursor (incremental mode only)
      if (!bootstrap && newHistoryId) {
        await supabase
          .from('team_members')
          .update({ last_history_id: newHistoryId })
          .eq('id', member.id)
      }
    } catch (err: any) {
      errors.push(`Member sync failed: ${err?.message ?? 'unknown'}`)
    }

    if (syncJob?.id) {
      await supabase
        .from('kb_sync_jobs')
        .update({
          status:           errors.length && emailsProcessed === 0 ? 'failed' : 'completed',
          emails_processed: emailsProcessed,
          emails_skipped:   emailsSkipped,
          kb_entries_added: kbEntriesAdded,
          errors,
          completed_at:     new Date().toISOString(),
        })
        .eq('id', syncJob.id)
    }

    totalEmailsProcessed += emailsProcessed
    totalKBEntries       += kbEntriesAdded
    totalSkipped         += emailsSkipped
    totalPersonalAdded   += personalAdded
    membersProcessed++

    await sleep(300)
  }

  return NextResponse.json({
    ok: true,
    mode: bootstrap ? `bootstrap_${daysBack}d` : 'incremental',
    membersProcessed,
    totalEmailsProcessed,
    totalKBEntriesAdded:  totalKBEntries,
    totalPersonalAdded,
    totalSkipped,
  })
}
