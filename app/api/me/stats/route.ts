import { NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'

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
    .select('status, completed_at, kb_entries_added, errors')
    .eq('member_id', member.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single()

  // Total KB entries for this member
  const { count: kbCount } = await supabase
    .from('email_knowledge_base')
    .select('id', { count: 'exact', head: true })
    .eq('owner_member_id', member.id)

  // Pending items in bootstrap queue for this member
  const { count: queueCount } = await supabase
    .from('kb_bootstrap_queue')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', member.id)
    .in('status', ['pending', 'processing'])

  return NextResponse.json({
    inbox:   inboxStats,
    todos:   todoStats,
    kbSync:  {
      lastSyncAt:       lastSync?.completed_at ?? null,
      lastEntriesAdded: lastSync?.kb_entries_added ?? 0,
      lastSyncErrors:   (lastSync?.errors as string[] | null) ?? [],
      totalKBEntries:   kbCount ?? 0,
      queueRemaining:   queueCount ?? 0,
    },
  })
}
