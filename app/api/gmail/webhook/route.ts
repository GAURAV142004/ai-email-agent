import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/auth'
import { safeDecrypt } from '@/lib/crypto'
import { fetchThread, fetchNewMessages } from '@/lib/gmail/thread'
import { analyzeEmailThread } from '@/lib/ai/analyze'
import { shouldSkipAIAnalysis } from '@/lib/ai/pre-filter'
import { indexEmailToKB } from '@/lib/kb/indexer'
import type { EmailClassificationRule } from '@/lib/supabase/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface PubSubMessage {
  emailAddress: string
  historyId:    string
}

function decodePubSubMessage(body: unknown): PubSubMessage | null {
  try {
    const message = (body as any)?.message
    if (!message?.data) return null
    const decoded = Buffer.from(message.data as string, 'base64').toString('utf-8')
    return JSON.parse(decoded) as PubSubMessage
  } catch {
    return null
  }
}

function extractEmailAddress(from: string): string {
  if (!from) return ''
  const match = from.match(/<([^>]+)>/)
  return match ? match[1].toLowerCase() : from.toLowerCase().trim()
}

function extractFromName(from: string): string {
  return from.replace(/<.+?>/, '').trim().replace(/^"|"$/g, '') || ''
}

// ─── Dual-path async processor ───────────────────────────────────────────────

async function processWebhookDualPath(notification: PubSubMessage): Promise<void> {
  const supabase = getServiceSupabase()

  // 1. Resolve team member by email address
  const { data: member } = await supabase
    .from('team_members')
    .select('id, email, last_history_id')
    .eq('email', notification.emailAddress)
    .eq('is_active', true)
    .single()

  if (!member) {
    // Don't log the email address — prevents user enumeration via logs
    console.error('[Webhook] Notification received for unknown or inactive member')
    return
  }

  // 2. Load Gmail tokens
  const { data: tokenRow } = await supabase
    .from('member_gmail_tokens')
    .select('access_token, refresh_token')
    .eq('member_id', member.id)
    .single()

  if (!tokenRow?.access_token) {
    console.error(`[Webhook] No tokens for member ${member.id}`)
    return
  }

  const accessToken  = safeDecrypt(tokenRow.access_token)
  const refreshToken = tokenRow.refresh_token ? safeDecrypt(tokenRow.refresh_token) : undefined

  // 3. Determine history cursor (use stored value; fall back to notification.historyId)
  const startHistoryId = member.last_history_id ?? notification.historyId

  // 4. Advance cursor BEFORE processing so parallel notifications don't duplicate work
  await supabase
    .from('team_members')
    .update({ last_history_id: notification.historyId })
    .eq('id', member.id)

  // 5. Fetch thread IDs added since startHistoryId
  let threadIds: string[]
  let newHistoryId: string | null = null
  try {
    const result = await fetchNewMessages(accessToken, startHistoryId, refreshToken)
    threadIds    = result.threadIds
    newHistoryId = result.newHistoryId
  } catch (err) {
    console.error('[Webhook] fetchNewMessages failed:', err)
    return
  }

  // Advance cursor to what Gmail actually returned (more accurate than the notification's historyId)
  if (newHistoryId && newHistoryId !== notification.historyId) {
    await supabase
      .from('team_members')
      .update({ last_history_id: newHistoryId })
      .eq('id', member.id)
  }

  // 6. Load active classification rules for PATH A (KB indexing)
  const { data: rulesData } = await supabase
    .from('email_classification_rules')
    .select('*')
    .eq('is_active', true)

  const rules: EmailClassificationRule[] = (rulesData as EmailClassificationRule[]) ?? []

  // 7. Process each thread via both paths
  for (const threadId of threadIds) {
    try {
      const thread = await fetchThread(threadId, accessToken, refreshToken)

      const rawFrom   = thread.messages[0]?.from ?? ''
      const fromEmail = extractEmailAddress(rawFrom) || thread.fromEmail
      const fromName  = extractFromName(rawFrom)
      const snippet   = thread.fullText.slice(0, 500)
      const firstMsgId = thread.messages[0]?.messageId ?? ''

      // ── PATH A: Knowledge Base indexing ──────────────────────────────────
      // indexEmailToKB handles pre-filtering, classification, and dedup internally
      try {
        await indexEmailToKB(supabase, rules, {
          memberId:       member.id,
          gmailThreadId:  threadId,
          gmailMessageId: firstMsgId,
          fromEmail,
          toEmail:        member.email,
          toEmails:       thread.toEmails,   // NEW
          ccEmails:       thread.ccEmails,   // NEW
          subject:        thread.subject,
          threadText:     thread.fullText,
          snippet,
          emailDate:      thread.receivedAt,
          direction:      'inbound',
        })
      } catch (kbErr) {
        console.error(`[Webhook] KB indexing failed for thread ${threadId}:`, kbErr)
      }

      // ── PATH B: Personal inbox ────────────────────────────────────────────
      // Check if already stored
      const { data: existingPersonal } = await supabase
        .from('personal_inbox_emails')
        .select('id')
        .eq('member_id', member.id)
        .eq('gmail_message_id', firstMsgId)
        .maybeSingle()

      if (existingPersonal) continue

      // Pre-filter automated/newsletter senders
      const preFilter = shouldSkipAIAnalysis(fromEmail, thread.subject, snippet)
      if (preFilter.skip) continue

      // AI analysis for personal inbox
      let analysis: Awaited<ReturnType<typeof analyzeEmailThread>>
      try {
        analysis = await analyzeEmailThread(thread.fullText, thread.subject)
      } catch (aiErr) {
        console.error(`[Webhook] AI analysis failed for thread ${threadId}:`, aiErr)
        continue
      }

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
    } catch (err) {
      console.error(`[Webhook] Failed to process thread ${threadId}:`, err)
    }
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

// Google Pub/Sub push endpoint — must ACK with 200 quickly to avoid retries
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Verify the request carries our webhook secret (added as ?token=... in the
  // Pub/Sub push subscription URL when the subscription was created).
  const { searchParams } = new URL(request.url)
  const providedToken    = searchParams.get('token')
  const expectedToken    = process.env.CRON_SECRET // reuse existing secret

  if (!expectedToken || !providedToken || providedToken !== expectedToken) {
    // Return 200 so Pub/Sub doesn't keep retrying — but do nothing.
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  const notification = decodePubSubMessage(body)
  if (!notification) {
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  // Fire-and-forget: fast ACK, process asynchronously
  processWebhookDualPath(notification).catch(() => {
    // Errors logged inside processWebhookDualPath
  })

  return NextResponse.json({ ok: true })
}
