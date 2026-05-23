import { NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { getGmailClient } from '@/lib/gmail/client'
import { fetchThread } from '@/lib/gmail/thread'
import { analyzeEmailThread } from '@/lib/ai/analyze'
import { shouldSkipAIAnalysis } from '@/lib/ai/pre-filter'
import { safeDecrypt } from '@/lib/crypto'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Extract display name from "Display Name <email@domain.com>" format
function extractFromName(from: string): string {
  return from.replace(/<.+?>/, '').trim().replace(/^"|"$/g, '') || from
}

// Extract bare email address from header value
function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return match ? match[1].trim() : from.trim()
}

// POST — manual sync of the authenticated member's personal inbox (last 20 messages)
export async function POST(): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()

  // Load Gmail tokens
  const { data: tokenRow, error: tokenError } = await supabase
    .from('member_gmail_tokens')
    .select('access_token, refresh_token')
    .eq('member_id', member.id)
    .single()

  if (tokenError || !tokenRow?.access_token) {
    return NextResponse.json(
      { error: 'No Gmail tokens found. Please sign out and sign in again.' },
      { status: 400 }
    )
  }

  const accessToken  = safeDecrypt(tokenRow.access_token)
  const refreshToken = tokenRow.refresh_token ? safeDecrypt(tokenRow.refresh_token) : undefined

  try {
    const gmail = getGmailClient(accessToken, refreshToken)

    const listRes = await gmail.users.messages.list({
      userId:     'me',
      labelIds:   ['INBOX'],
      maxResults: 20,
    })

    const messages   = listRes.data.messages ?? []
    const threadsSeen = new Set<string>()
    let processed = 0
    let skipped   = 0

    for (const msg of messages) {
      const threadId   = msg.threadId
      const messageId  = msg.id
      if (!threadId || !messageId) continue
      // Only process the first message encountered per thread
      if (threadsSeen.has(threadId)) continue
      threadsSeen.add(threadId)

      // Skip if this gmail_message_id already in personal_inbox_emails for this member
      const { data: existing } = await supabase
        .from('personal_inbox_emails')
        .select('id')
        .eq('member_id', member.id)
        .eq('gmail_message_id', messageId)
        .maybeSingle()

      if (existing) { skipped++; continue }

      try {
        const thread = await fetchThread(threadId, accessToken, refreshToken)

        const rawFrom  = thread.messages[0]?.from ?? ''
        const fromEmail = extractEmailAddress(rawFrom) || thread.fromEmail
        const fromName  = extractFromName(rawFrom)
        const snippet   = thread.fullText.slice(0, 500)

        // Pre-filter: skip automated/newsletter emails
        const preFilter = shouldSkipAIAnalysis(fromEmail, thread.subject, snippet)
        if (preFilter.skip) {
          skipped++
          continue
        }

        // Analyse with AI (summary, priority, isActionable)
        const analysis = await analyzeEmailThread(thread.fullText, thread.subject)

        const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()

        await supabase.from('personal_inbox_emails').insert({
          member_id:       member.id,
          gmail_thread_id: threadId,
          gmail_message_id: messageId,
          subject:         thread.subject,
          from_email:      fromEmail,
          from_name:       fromName || null,
          snippet:         snippet || null,
          received_at:     thread.receivedAt,
          is_read:         false,
          ai_summary:      analysis.summary,
          ai_priority:     analysis.priority,
          is_actionable:   analysis.requiresAction,
          reply_sent:      false,
          expires_at:      expiresAt,
        })

        processed++
      } catch (err) {
        console.error(`[Gmail Sync] Failed to process thread ${threadId}:`, err)
      }

      // Throttle AI calls to avoid Bedrock rate limits
      await sleep(500)
    }

    return NextResponse.json({ ok: true, processed, skipped })
  } catch (err) {
    console.error('[Gmail Sync] Sync failed:', err)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
