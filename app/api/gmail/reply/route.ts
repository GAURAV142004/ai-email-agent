import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { sendGmailReply, getLastMessageId } from '@/lib/gmail/reply'
import { safeDecrypt } from '@/lib/crypto'

// ─── Request schema ───────────────────────────────────────────────────────────

const ReplySchema = z.object({
  personalEmailId: z.string().uuid('personalEmailId must be a UUID'),
  toEmail:         z.string().email('toEmail must be a valid email address'),
  subject:         z.string().min(1, 'subject is required'),
  bodyHtml:        z.string().min(1, 'bodyHtml is required'),
})

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Auth check
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Parse + validate body
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = ReplySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { personalEmailId, toEmail, subject, bodyHtml } = parsed.data
  const supabase = getServiceSupabase()

  // Load the personal inbox record and verify ownership
  const { data: personalEmail, error: fetchError } = await supabase
    .from('personal_inbox_emails')
    .select('id, member_id, gmail_thread_id, gmail_message_id, reply_sent')
    .eq('id', personalEmailId)
    .single()

  if (fetchError || !personalEmail) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  }

  if (personalEmail.member_id !== member.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (personalEmail.reply_sent) {
    return NextResponse.json(
      { error: 'A reply has already been sent for this email' },
      { status: 409 }
    )
  }

  // Load Gmail tokens for this member
  const { data: tokenRow, error: tokenError } = await supabase
    .from('member_gmail_tokens')
    .select('access_token, refresh_token')
    .eq('member_id', member.id)
    .single()

  if (tokenError || !tokenRow?.access_token) {
    return NextResponse.json(
      { error: 'Gmail not connected. Please sign out and sign in again.' },
      { status: 422 }
    )
  }

  const accessToken  = safeDecrypt(tokenRow.access_token)
  const refreshToken = tokenRow.refresh_token ? safeDecrypt(tokenRow.refresh_token) : ''

  if (!refreshToken) {
    return NextResponse.json(
      { error: 'Gmail refresh token missing. Please re-authenticate.' },
      { status: 422 }
    )
  }

  const gmailThreadId = personalEmail.gmail_thread_id

  // Get the In-Reply-To message ID (RFC 2822 Message-ID of the last message)
  let inReplyToMessageId: string | null
  try {
    inReplyToMessageId = await getLastMessageId(accessToken, refreshToken, gmailThreadId)
  } catch (err) {
    console.error('[Reply] getLastMessageId failed:', err)
    return NextResponse.json(
      { error: 'Could not retrieve message ID for reply threading' },
      { status: 502 }
    )
  }

  if (!inReplyToMessageId) {
    return NextResponse.json(
      { error: 'Could not determine the message to reply to' },
      { status: 422 }
    )
  }

  // Send the reply via Gmail API
  let result: { messageId: string; threadId: string }
  try {
    result = await sendGmailReply({
      accessToken,
      refreshToken,
      gmailThreadId,
      toEmail,
      subject,
      bodyHtml,
      inReplyToMessageId,
    })
  } catch (err) {
    console.error('[Reply] sendGmailReply failed:', err)
    return NextResponse.json({ error: 'Failed to send reply via Gmail' }, { status: 502 })
  }

  // Mark the inbox record as replied
  const { error: updateError } = await supabase
    .from('personal_inbox_emails')
    .update({ reply_sent: true })
    .eq('id', personalEmailId)

  if (updateError) {
    // Reply was sent — log the DB failure but don't surface a 500 to the caller
    console.error('[Reply] Failed to update reply_sent flag:', updateError)
  }

  return NextResponse.json({ ok: true, messageId: result.messageId })
}
