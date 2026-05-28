import { NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { getGmailClient } from '@/lib/gmail/client'
import { fetchThread } from '@/lib/gmail/thread'
import { safeDecrypt } from '@/lib/crypto'
import { indexEmailToKB } from '@/lib/kb/indexer'
import type { EmailClassificationRule } from '@/lib/supabase/types'

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

  // Load active classification rules
  const { data: rulesData } = await supabase
    .from('email_classification_rules')
    .select('*')
    .eq('is_active', true)
  const rules: EmailClassificationRule[] = (rulesData as EmailClassificationRule[]) ?? []

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

      // Skip if this thread is already indexed globally and the member is already a participant
      const { data: existing } = await supabase
        .from('email_knowledge_base')
        .select('id, participant_member_ids')
        .eq('gmail_thread_id', threadId)
        .maybeSingle()

      if (existing) {
        const currentParticipants = (existing.participant_member_ids as string[]) ?? []
        if (currentParticipants.includes(member.id)) {
          skipped++
          continue
        }
      }

      try {
        const thread = await fetchThread(threadId, accessToken, refreshToken)

        const firstMsgId = thread.messages[0]?.messageId ?? ''
        const rawFrom    = thread.messages[0]?.from ?? ''
        const fromEmail  = extractEmailAddress(rawFrom) || thread.fromEmail
        const snippet    = thread.fullText.slice(0, 500)

        const kbResult = await indexEmailToKB(supabase, rules, {
          memberId:       member.id,
          gmailThreadId:  threadId,
          gmailMessageId: firstMsgId,
          fromEmail,
          toEmail:        member.email,
          toEmails:       thread.toEmails,
          ccEmails:       thread.ccEmails,
          subject:        thread.subject,
          threadText:     thread.fullText,
          snippet,
          emailDate:      thread.receivedAt,
          direction:      'inbound',
          attachments:    thread.attachments,
          accessToken,
          refreshToken,
        })

        if (kbResult.indexed || kbResult.merged) {
          processed++
          // Throttle AI calls to avoid Bedrock rate limits (only when actually indexing/analyzing)
          if (kbResult.indexed) {
            await sleep(500)
          }
        } else {
          skipped++
        }
      } catch (err) {
        console.error(`[Gmail Sync] Failed to process thread ${threadId}:`, err)
      }
    }

    return NextResponse.json({ ok: true, processed, skipped })
  } catch (err) {
    console.error('[Gmail Sync] Sync failed:', err)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
