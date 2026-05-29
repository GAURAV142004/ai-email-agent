import { NextResponse, after } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { runKBSync } from '@/lib/kb/run-sync'

export async function GET(): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()
  const now      = new Date()
  const today    = now.toISOString().split('T')[0]

  // Personal inbox stats
  const { data: inboxRows } = await supabase
    .from('personal_inbox_emails')
    .select('id, is_read, ai_priority, is_actionable, reply_sent, received_at')
    .eq('member_id', member.id)
    .gt('expires_at', now.toISOString())

  const emails = inboxRows ?? []
  const inboxStats = {
    total:       emails.length,
    unread:      emails.filter(e => !e.is_read).length,
    actionable:  emails.filter(e => e.is_actionable).length,
    highPriority: emails.filter(e => e.ai_priority === 'high').length,
    replySent:   emails.filter(e => e.reply_sent).length,
    receivedToday: emails.filter(e => e.received_at?.startsWith(today)).length,
  }

  // Today's todo stats
  const { data: todoRows } = await supabase
    .from('daily_todos')
    .select('id, status, priority')
    .eq('member_id', member.id)
    .eq('due_date', today)

  const todos = todoRows ?? []
  const todoStats = {
    total:      todos.length,
    pending:    todos.filter(t => t.status === 'pending').length,
    inProgress: todos.filter(t => t.status === 'in_progress').length,
    completed:  todos.filter(t => t.status === 'completed').length,
    deferred:   todos.filter(t => t.status === 'deferred').length,
  }

  // KB sync status
  const { data: lastSync } = await supabase
    .from('kb_sync_jobs')
    .select('status, completed_at, kb_entries_added, emails_processed, errors')
    .eq('member_id', member.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single()

  // Total KB entries visible to this member (owned or participated)
  const { count: kbCount } = await supabase
    .from('email_knowledge_base')
    .select('id', { count: 'exact', head: true })
    .or(`owner_member_id.eq.${member.id},participant_member_ids.cs.{${member.id}}`)

  // Total emails fetched (threads evaluated) from last completed sync job
  const lastSyncJob = lastSync as any
  const lastEmailsFetched: number = lastSyncJob?.emails_processed ?? 0
  const lastKbAdded:      number = lastSyncJob?.kb_entries_added ?? 0

  // All-time emails fetched across all sync jobs for this member
  const { data: allSyncJobs } = await supabase
    .from('kb_sync_jobs')
    .select('emails_processed, kb_entries_added')
    .eq('member_id', member.id)
    .eq('status', 'completed')

  const totalEmailsFetched = (allSyncJobs ?? []).reduce(
    (sum: number, j: any) => sum + (j.emails_processed ?? 0), 0
  )

  // Pending items in bootstrap queue for this member
  const { count: queueCount } = await supabase
    .from('kb_bootstrap_queue')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', member.id)
    .in('status', ['pending', 'processing'])

  // Trigger throttled background sync asynchronously
  after(async () => {
    try {
      const supabaseAdmin = getServiceSupabase()
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
      const { count } = await supabaseAdmin
        .from('kb_sync_jobs')
        .select('id', { count: 'exact', head: true })
        .gt('started_at', twoMinutesAgo)

      if (count && count > 0) {
        console.log('[Stats GET] Background KB sync throttled (recent sync exists).')
        return
      }

      console.log('[Stats GET] Triggering background KB sync post-stats-load...')
      await runKBSync()
    } catch (err) {
      console.error('[Stats GET] Background KB sync failed:', err)
    }
  })

  return NextResponse.json({
    inbox:   inboxStats,
    todos:   todoStats,
    kbSync:  {
      lastSyncAt:          lastSync?.completed_at ?? null,
      lastEntriesAdded:    lastKbAdded,
      lastEmailsFetched:   lastEmailsFetched,
      lastSyncErrors:      (lastSync?.errors as string[] | null) ?? [],
      totalKBEntries:      kbCount ?? 0,
      totalEmailsFetched,
      queueRemaining:      queueCount ?? 0,
    },
  })
}
