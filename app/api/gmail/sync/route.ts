import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, getServiceSupabase } from '@/lib/auth'
import { getGmailClient } from '@/lib/gmail/client'
import { fetchThread } from '@/lib/gmail/thread'
import { analyzeEmailThread } from '@/lib/ai/analyze'
import { safeDecrypt } from '@/lib/crypto'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()

  const { data: account } = await supabase
    .from('connected_accounts')
    .select('id, access_token, refresh_token')
    .eq('user_id', user.id)
    .eq('provider', 'gmail')
    .single()

  if (!account?.access_token) {
    return NextResponse.json({ error: 'No Gmail account connected' }, { status: 400 })
  }

  const accessToken = safeDecrypt(account.access_token)
  const refreshToken = account.refresh_token ? safeDecrypt(account.refresh_token) : undefined

  // Look up team_members row to populate owner_member_id on new threads
  const { data: memberRow } = await supabase
    .from('team_members')
    .select('id')
    .eq('email', user.email)
    .eq('is_active', true)
    .single()

  try {
    const gmail = getGmailClient(accessToken, refreshToken)

    const messagesRes = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 20,
    })

    const messages = messagesRes.data.messages ?? []
    const threadsSeen = new Set<string>()
    let processed = 0
    let skipped = 0

    for (const msg of messages) {
      if (!msg.threadId || threadsSeen.has(msg.threadId)) continue
      threadsSeen.add(msg.threadId)

      // Skip already processed threads
      const { data: existing } = await supabase
        .from('email_threads')
        .select('id')
        .eq('user_id', user.id)
        .eq('thread_id', msg.threadId)
        .single()

      if (existing) { skipped++; continue }

      try {
        const thread = await fetchThread(
          msg.threadId,
          accessToken,
          refreshToken
        )
        const analysis = await analyzeEmailThread(thread.fullText, thread.subject)

        const { data: storedThread, error: threadError } = await supabase
          .from('email_threads')
          .insert({
            user_id:          user.id,
            owner_member_id:  memberRow?.id ?? null,
            thread_id:        thread.threadId,
            subject:          thread.subject,
            from_email:       thread.fromEmail,
            received_at:      thread.receivedAt,
            summary:          analysis.summary,
            email_link:       thread.emailLink,
            processed_at:     new Date().toISOString(),
            pii_was_masked:   analysis.piiItemsFound > 0,
            pii_types_found:  [],
          })
          .select('id')
          .single()

        if (threadError || !storedThread) {
          console.error('Failed to store thread:', threadError)
          continue
        }

        await supabase.from('ai_logs').insert({
          thread_id: storedThread.id,
          user_id: user.id,
          model_used: 'claude-3-haiku',
          response: JSON.stringify(analysis),
          pii_items_found: analysis.piiItemsFound,
        })

        if (analysis.requiresAction && analysis.tasks.length > 0) {
          await supabase.from('tasks').insert(
            analysis.tasks.map((task) => ({
              thread_id: storedThread.id,
              user_id: user.id,
              task: task.task,
              priority: task.priority,
              due_date: task.due_date,
              assigned_to: null,
              status: 'pending' as const,
            }))
          )
        }

        processed++
      } catch (err) {
        console.error(`Failed to process thread ${msg.threadId}:`, err)
      }

      await sleep(1000)
    }

    return NextResponse.json({ ok: true, processed, skipped })
  } catch (err) {
    console.error('Gmail sync error:', err)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
