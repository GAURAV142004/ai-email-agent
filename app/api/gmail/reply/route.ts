import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { canReply, type TeamRole } from '@/lib/roles'
import { sendGmailReply, getLastMessageId } from '@/lib/gmail/reply'
import { safeDecrypt } from '@/lib/crypto'
import { autoUpdateThreadTasks } from '@/lib/tasks/auto-update'

// Simple in-memory rate limit: 5 replies per member per minute
const replyRateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkReplyRateLimit(memberId: string): boolean {
  const now = Date.now()
  const entry = replyRateLimitMap.get(memberId)
  if (!entry || now > entry.resetAt) {
    replyRateLimitMap.set(memberId, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (entry.count >= 5) return false
  entry.count++
  return true
}

const ReplySchema = z.object({
  threadDbId:    z.string().uuid(),
  gmailThreadId: z.string(),
  toEmail:       z.string().email(),
  subject:       z.string().min(1),
  bodyHtml:      z.string().min(1),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!checkReplyRateLimit(member.id)) {
    return NextResponse.json(
      { error: 'Too many replies. Please wait a minute.' },
      { status: 429 }
    )
  }

  const body = await request.json()
  const parsed = ReplySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  const { threadDbId, gmailThreadId, toEmail, subject, bodyHtml } = parsed.data
  const supabase = getServiceSupabase()

  // Fetch thread + owner role for permission check
  const { data: thread, error: threadError } = await supabase
    .from('email_threads')
    .select('id, thread_id, subject, received_at, owner_member_id, owner:team_members!owner_member_id(role)')
    .eq('id', threadDbId)
    .single()

  if (threadError || !thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }

  const ownerRole = (thread as any).owner?.role as TeamRole
  if (!canReply(member.role, ownerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Resolve Gmail tokens — member_gmail_tokens first, connected_accounts as fallback
  let accessToken: string | null = null
  let refreshToken: string | null = null

  const { data: memberToken } = await supabase
    .from('member_gmail_tokens')
    .select('access_token, refresh_token')
    .eq('member_id', member.id)
    .maybeSingle()

  if (memberToken) {
    accessToken  = safeDecrypt((memberToken as any).access_token)
    refreshToken = safeDecrypt((memberToken as any).refresh_token)
  } else {
    const { data: account } = await supabase
      .from('connected_accounts')
      .select('access_token, refresh_token')
      .eq('email', member.email)
      .eq('status', 'active')
      .maybeSingle()
    const raw = account as any
    accessToken  = raw?.access_token ? safeDecrypt(raw.access_token) : null
    refreshToken = raw?.refresh_token ? safeDecrypt(raw.refresh_token) : null
  }

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: 'Gmail not connected for this member' }, { status: 422 })
  }

  // Get In-Reply-To message ID
  const inReplyToMessageId = await getLastMessageId(accessToken, refreshToken, gmailThreadId)
  if (!inReplyToMessageId) {
    return NextResponse.json({ error: 'Could not determine reply-to message ID' }, { status: 422 })
  }

  // Send via Gmail API
  const result = await sendGmailReply({
    accessToken,
    refreshToken,
    gmailThreadId,
    toEmail,
    subject,
    bodyHtml,
    inReplyToMessageId,
  })

  // Record reply
  await supabase.from('email_replies').insert({
    thread_id:        threadDbId,
    sent_by_member:   member.id,
    to_email:         toEmail,
    subject,
    body:             bodyHtml,
    gmail_message_id: result.messageId,
  })

  // Compute response time from last inbound message (fall back to thread received_at)
  const sentAt = new Date()
  const { data: lastInbound } = await supabase
    .from('email_thread_messages')
    .select('sent_at')
    .eq('thread_id', threadDbId)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastInboundAt = lastInbound?.sent_at
    ? new Date(lastInbound.sent_at)
    : (thread as any).received_at
      ? new Date((thread as any).received_at)
      : null

  const responseMinutes = lastInboundAt
    ? Math.floor((sentAt.getTime() - lastInboundAt.getTime()) / 60_000)
    : null

  // Add to conversation timeline
  const plainSnippet = bodyHtml.replace(/<[^>]+>/g, '').slice(0, 200)
  await supabase.from('email_thread_messages').insert({
    thread_id:        threadDbId,
    owner_member_id:  member.id,
    gmail_message_id: result.messageId,
    direction:        'outbound',
    from_email:       member.email,
    from_name:        member.name,
    subject,
    snippet:          plainSnippet,
    sent_at:          sentAt.toISOString(),
    response_minutes: responseMinutes,
    source:           'app',
  })

  // Recompute thread reply summary
  const { data: outboundRows } = await supabase
    .from('email_thread_messages')
    .select('sent_at')
    .eq('thread_id', threadDbId)
    .eq('direction', 'outbound')
    .order('sent_at', { ascending: true })

  const { count: msgCount } = await supabase
    .from('email_thread_messages')
    .select('*', { count: 'exact', head: true })
    .eq('thread_id', threadDbId)

  // Update thread: mark replied + response time + summary counts
  await supabase
    .from('email_threads')
    .update({
      reply_status:          'replied',
      replied_at:            sentAt.toISOString(),
      response_minutes:      responseMinutes,
      reply_count:           outboundRows?.length ?? 1,
      first_replied_at:      outboundRows?.[0]?.sent_at ?? sentAt.toISOString(),
      last_outbound_at:      sentAt.toISOString(),
      message_count:         msgCount ?? undefined,
      awaiting_reply_since:  null,   // member just replied — thread not awaiting
      // Set first_response_minutes only on first reply
      ...(outboundRows?.length === 1 && responseMinutes !== null && {
        first_response_minutes: responseMinutes,
      }),
    })
    .eq('id', threadDbId)

  // Auto-update tasks when reply sent from app
  try {
    await autoUpdateThreadTasks(threadDbId, 'reply_sent')
  } catch (err) {
    console.error('Task auto-update error:', err instanceof Error ? err.message : 'Unknown')
  }

  return NextResponse.json({ success: true, messageId: result.messageId })
}
