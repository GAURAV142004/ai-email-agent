import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/auth'

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceSupabase()

  // Delete expired personal inbox emails
  const { count: emailsDeleted } = await supabase
    .from('personal_inbox_emails')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString())

  // Delete todos whose linked email no longer exists
  const { data: orphanTodos } = await supabase
    .from('daily_todos')
    .select('id, linked_email_id')
    .not('linked_email_id', 'is', null)

  let todosOrphaned = 0
  if (orphanTodos?.length) {
    const linkedIds = orphanTodos.map(t => t.linked_email_id).filter(Boolean)
    const { data: existingEmails } = await supabase
      .from('personal_inbox_emails')
      .select('id')
      .in('id', linkedIds)

    const existingSet = new Set((existingEmails ?? []).map(e => e.id))
    const toDelete = orphanTodos
      .filter(t => !existingSet.has(t.linked_email_id))
      .map(t => t.id)

    if (toDelete.length) {
      const { count } = await supabase
        .from('daily_todos')
        .delete({ count: 'exact' })
        .in('id', toDelete)
      todosOrphaned = count ?? 0
    }
  }

  return NextResponse.json({
    ok: true,
    emailsDeleted:     emailsDeleted ?? 0,
    todosOrphansCleared: todosOrphaned,
  })
}
