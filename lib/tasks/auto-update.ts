import { getServiceSupabase } from '@/lib/auth'

export type TaskAutoUpdateReason =
  | 'reply_sent'       // member sent a reply
  | 'thread_resolved'  // thread marked as resolved
  | 'reply_received'   // client replied back (awaiting our response)

export async function autoUpdateThreadTasks(
  threadDbId: string,
  reason: TaskAutoUpdateReason,
): Promise<{ updated: number }> {
  const supabase = getServiceSupabase()

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, status, task')
    .eq('thread_id', threadDbId)
    .in('status', ['pending', 'in_progress'])

  if (!tasks || tasks.length === 0) return { updated: 0 }

  let updated = 0

  if (reason === 'reply_sent') {
    const pendingTasks = tasks.filter(t => t.status === 'pending')
    if (pendingTasks.length > 0) {
      await supabase
        .from('tasks')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('thread_id', threadDbId)
        .eq('status', 'pending')
      updated = pendingTasks.length
    }
  }

  if (reason === 'thread_resolved') {
    await supabase
      .from('tasks')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('thread_id', threadDbId)
      .in('status', ['pending', 'in_progress'])
    updated = tasks.length
  }

  // reply_received: no status change — client replied, member still needs to act
  // Tasks remain pending/in_progress so they stay visible

  return { updated }
}
