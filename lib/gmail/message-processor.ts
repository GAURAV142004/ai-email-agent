import { getServiceSupabase } from '@/lib/auth'
import type { EmailMessage } from './thread'
import { autoUpdateThreadTasks } from '@/lib/tasks/auto-update'

function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/)
  return match ? match[1].trim() : from.trim()
}

function extractName(from: string): string {
  return from.replace(/<.+?>/, '').trim().replace(/^"|"$/g, '')
}

export async function processThreadMessages(
  threadDbId: string,
  ownerEmail: string,
  messages: EmailMessage[],
  memberId: string,
): Promise<void> {
  if (messages.length === 0) return
  const supabase = getServiceSupabase()

  let lastInboundAt: Date | null = null

  const rows = messages
    .filter(m => m.messageId)
    .map(msg => {
      const fromEmail = extractEmail(msg.from)
      const fromName  = extractName(msg.from)
      const direction =
        fromEmail.toLowerCase() === ownerEmail.toLowerCase() ? 'outbound' : 'inbound'
      const sentAt = msg.date ? new Date(msg.date) : null

      let responseMinutes: number | null = null
      if (direction === 'outbound' && lastInboundAt && sentAt) {
        responseMinutes = Math.max(
          0,
          Math.floor((sentAt.getTime() - lastInboundAt.getTime()) / 60_000),
        )
      }
      if (direction === 'inbound' && sentAt) {
        lastInboundAt = sentAt
      }

      return {
        thread_id:        threadDbId,
        owner_member_id:  memberId || null,
        gmail_message_id: msg.messageId,
        direction,
        from_email:       fromEmail,
        from_name:        fromName,
        subject:          msg.subject,
        snippet:          msg.body.slice(0, 200),
        sent_at:          sentAt?.toISOString() ?? null,
        response_minutes: responseMinutes,
        source:           'gmail',
      }
    })

  if (rows.length === 0) return

  await supabase
    .from('email_thread_messages')
    .upsert(rows, { onConflict: 'gmail_message_id', ignoreDuplicates: true })

  // Recompute thread summary from all stored rows
  const { data: stored } = await supabase
    .from('email_thread_messages')
    .select('direction, sent_at, response_minutes')
    .eq('thread_id', threadDbId)
    .order('sent_at', { ascending: true })

  if (!stored) return

  const inbound  = stored.filter(r => r.direction === 'inbound')
  const outbound = stored.filter(r => r.direction === 'outbound')
  const lastMsg  = stored[stored.length - 1]

  // Thread awaits reply if the last message came from the client (inbound)
  const awaitingReplySince = lastMsg?.direction === 'inbound' ? lastMsg.sent_at : null

  // First response time: only set once, from thread.received_at to first outbound
  const { data: threadRow } = await supabase
    .from('email_threads')
    .select('received_at, first_replied_at')
    .eq('id', threadDbId)
    .single()

  const firstOutbound = outbound[0]
  const receivedAt      = threadRow?.received_at    ? new Date(threadRow.received_at) : null
  const firstOutboundAt = firstOutbound?.sent_at    ? new Date(firstOutbound.sent_at) : null
  const firstResponseMinutes =
    !threadRow?.first_replied_at && receivedAt && firstOutboundAt
      ? Math.max(0, Math.floor((firstOutboundAt.getTime() - receivedAt.getTime()) / 60_000))
      : undefined

  await supabase
    .from('email_threads')
    .update({
      message_count:          stored.length,
      reply_count:            outbound.length,
      first_replied_at:       outbound[0]?.sent_at ?? null,
      last_inbound_at:        inbound.at(-1)?.sent_at ?? null,
      last_outbound_at:       outbound.at(-1)?.sent_at ?? null,
      awaiting_reply_since:   awaitingReplySince,
      ...(firstResponseMinutes !== undefined && {
        first_response_minutes: firstResponseMinutes,
      }),
    })
    .eq('id', threadDbId)

  // Auto-update tasks: if any current batch message is outbound, a reply was detected
  const hasNewOutbound = rows.some(r => r.direction === 'outbound')
  if (hasNewOutbound) {
    try {
      await autoUpdateThreadTasks(threadDbId, 'reply_sent')
    } catch (err) {
      console.error('Task auto-update error:', err instanceof Error ? err.message : 'Unknown')
    }
  }
}
