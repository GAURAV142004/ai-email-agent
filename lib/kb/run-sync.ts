import { getServiceSupabase } from '@/lib/auth'
import { indexEmailToKB } from './indexer'
import { fetchThread, fetchNewMessages, fetchRecentThreadIds } from '@/lib/gmail/thread'
import { analyzeEmailThread } from '@/lib/ai/analyze'
import { shouldSkipAIAnalysis } from '@/lib/ai/pre-filter'
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

export interface SyncParams {
  bootstrap?: boolean
  daysBack?:  number
  maxThreadsPerMember?: number // Hobby-plan safety valve
}

export interface SyncResult {
  ok:                   boolean
  mode:                 string
  membersProcessed:     number
  totalEmailsProcessed: number
  totalKBEntriesAdded:  number
  totalPersonalAdded:   number
  totalSkipped:         number
  errors:               string[]
}

export async function runKBSync(params: SyncParams = {}): Promise<SyncResult> {
  const {
    bootstrap = false,
    daysBack  = 30,
    maxThreadsPerMember = bootstrap ? 50 : 200,
  } = params

  const supabase = getServiceSupabase()

  const { data: members } = await supabase
    .from('team_members')
    .select('id, email, last_history_id')
    .eq('is_active', true)
    .eq('consent_given', true)

  if (!members?.length) {
    return {
      ok: true, mode: bootstrap ? `bootstrap_${daysBack}d` : 'incremental',
      membersProcessed: 0, totalEmailsProcessed: 0, totalKBEntriesAdded: 0,
      totalPersonalAdded: 0, totalSkipped: 0, errors: [],
    }
  }

  const { data: rules } = await supabase
    .from('email_classification_rules')
    .select('*')
    .eq('is_active', true)

  const classificationRules: EmailClassificationRule[] = (rules as EmailClassificationRule[]) ?? []

  let totalEmailsProcessed = 0
  let totalKBEntries       = 0
  let totalSkipped         = 0
  let totalPersonalAdded   = 0
  let membersProcessed     = 0
  const allErrors: string[]  = []

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
        threadIds = await fetchRecentThreadIds(accessToken, daysBack, refreshToken, maxThreadsPerMember)
      } else {
        const result = await fetchNewMessages(accessToken, member.last_history_id, refreshToken)
        threadIds    = result.threadIds.slice(0, maxThreadsPerMember)
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

          // PATH A: KB indexing
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
            errors.push(`KB ${threadId}: ${kbErr?.message ?? 'unknown'}`)
          }

          // PATH B: Personal inbox
          const { data: existingPersonal } = await supabase
            .from('personal_inbox_emails')
            .select('id')
            .eq('member_id', member.id)
            .eq('gmail_message_id', firstMsgId)
            .maybeSingle()

          if (!existingPersonal) {
            const snippet   = thread.fullText.slice(0, 500)
            const preFilter = shouldSkipAIAnalysis(fromEmail, thread.subject, snippet)

            if (!preFilter.skip) {
              try {
                const analysis = await analyzeEmailThread(thread.fullText, thread.subject)
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
                  expires_at:       new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
                })
                personalAdded++
              } catch (aiErr: any) {
                errors.push(`Inbox ${threadId}: ${aiErr?.message ?? 'unknown'}`)
              }
            }
          }

          emailsProcessed++
          await sleep(200)
        } catch (err: any) {
          errors.push(`Thread ${threadId}: ${err?.message ?? 'unknown error'}`)
          emailsSkipped++
        }
      }

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
    allErrors.push(...errors)

    await sleep(300)
  }

  return {
    ok:                   true,
    mode:                 bootstrap ? `bootstrap_${daysBack}d` : 'incremental',
    membersProcessed,
    totalEmailsProcessed,
    totalKBEntriesAdded:  totalKBEntries,
    totalPersonalAdded,
    totalSkipped,
    errors:               allErrors,
  }
}
