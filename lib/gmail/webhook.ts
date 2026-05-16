import { getServiceSupabase } from '@/lib/auth'
import { fetchNewMessages, fetchThread } from './thread'
import { analyzeEmailThread } from '@/lib/ai/analyze'
import { safeDecrypt } from '@/lib/crypto'
import { processThreadMessages } from './message-processor'

export interface PubSubMessage {
  emailAddress: string
  historyId: string
}

export function decodePubSubMessage(body: any): PubSubMessage | null {
  try {
    const message = body?.message
    if (!message?.data) return null

    const decoded = Buffer.from(message.data, 'base64').toString('utf-8')
    return JSON.parse(decoded) as PubSubMessage
  } catch {
    return null
  }
}

export async function processWebhookNotification(notification: PubSubMessage): Promise<void> {
  const supabase = getServiceSupabase()

  // Find the connected account for this email address
  const { data: account } = await supabase
    .from('connected_accounts')
    .select('id, user_id, access_token, refresh_token, last_history_id')
    .eq('email', notification.emailAddress)
    .eq('status', 'active')
    .single()

  if (!account?.access_token) {
    console.error(`No active account found for ${notification.emailAddress}`)
    return
  }

  const userId = account.user_id
  const accessToken = safeDecrypt(account.access_token)
  const refreshToken = account.refresh_token ? safeDecrypt(account.refresh_token) : undefined

  // Look up the team_members row to populate owner_member_id
  const { data: memberRow } = await supabase
    .from('team_members')
    .select('id')
    .eq('email', notification.emailAddress)
    .eq('is_active', true)
    .single()

  // Use the stored (previous) historyId as the start; notification.historyId is the new cursor
  const startHistoryId = account.last_history_id ?? notification.historyId

  // Update cursor immediately so parallel notifications don't reprocess the same history
  await supabase
    .from('connected_accounts')
    .update({ last_history_id: notification.historyId })
    .eq('id', account.id)

  // Fetch new thread IDs from Gmail history since the previous cursor
  const threadIds = await fetchNewMessages(
    accessToken,
    startHistoryId,
    refreshToken
  )

  for (const threadId of threadIds) {
    try {
      // Check if thread already exists in DB
      const { data: existing } = await supabase
        .from('email_threads')
        .select('id')
        .eq('user_id', userId)
        .eq('thread_id', threadId)
        .single()

      // Fetch full thread content (needed for both new and existing)
      const thread = await fetchThread(threadId, accessToken, refreshToken)

      if (existing) {
        // Thread exists — process any new messages (e.g. a reply arrived)
        await processThreadMessages(existing.id, notification.emailAddress, thread.messages, memberRow?.id ?? '')
        continue
      }

      // Analyze with Claude AI
      const analysis = await analyzeEmailThread(thread.fullText, thread.subject)

      // Store email thread
      const { data: storedThread, error: threadError } = await supabase
        .from('email_threads')
        .insert({
          user_id:          userId,
          owner_member_id:  memberRow?.id ?? null,
          thread_id:        thread.threadId,
          subject:          thread.subject,
          from_email:       thread.fromEmail,
          received_at:      thread.receivedAt,
          summary:          analysis.summary,
          email_link:       thread.emailLink,
          processed_at:     new Date().toISOString(),
          pii_was_masked:   analysis._pii?.wasMasked ?? false,
          pii_types_found:  analysis._pii?.detectedTypes ?? [],
        })
        .select('id')
        .single()

      if (threadError || !storedThread) {
        console.error('Failed to store thread:', threadError)
        continue
      }

      // Log AI usage
      await supabase.from('ai_logs').insert({
        thread_id: storedThread.id,
        user_id: userId,
        model_used: 'gemini-2.5-flash',
        response: JSON.stringify(analysis),
        pii_items_found: analysis._pii?.itemsRemoved ?? 0,
      })

      // Store extracted tasks
      if (analysis.requires_action && analysis.tasks.length > 0) {
        const tasks = analysis.tasks.map((task) => ({
          thread_id: storedThread.id,
          user_id: userId,
          task: task.task,
          priority: task.priority,
          due_date: task.due_date,
          assigned_to: task.assigned_to,
          status: 'pending' as const,
        }))

        await supabase.from('tasks').insert(tasks)
      }

      // Process all messages into timeline
      await processThreadMessages(storedThread.id, notification.emailAddress, thread.messages, memberRow?.id ?? '')
    } catch (err) {
      console.error(`Failed to process thread ${threadId}:`, err)
    }
  }
}
