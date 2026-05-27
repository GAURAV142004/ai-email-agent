import { getServiceSupabase } from '@/lib/auth'
import { google } from 'googleapis'
import { safeDecrypt } from '@/lib/crypto'

export async function cleanupPersonal() {
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

  return { emailsDeleted: emailsDeleted ?? 0, todosOrphansCleared: todosOrphaned }
}

export async function renewWatches() {
  const supabase = getServiceSupabase()

  // Find members whose watch expires in < 2 days
  const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()

  const { data: expiring } = await supabase
    .from('team_members')
    .select('id, email')
    .lt('watch_expiry', twoDaysFromNow)
    .eq('is_active', true)

  if (!expiring || expiring.length === 0) {
    return { renewed: 0, total: 0 }
  }

  let renewed = 0
  const errors: string[] = []

  for (const member of expiring) {
    try {
      const { data: memberTokens } = await supabase
        .from('member_gmail_tokens')
        .select('access_token, refresh_token')
        .eq('member_id', member.id)
        .single()

      if (!memberTokens?.access_token || !memberTokens?.refresh_token) continue

      const accessToken  = safeDecrypt((memberTokens as any).access_token)
      const refreshToken = safeDecrypt((memberTokens as any).refresh_token)

      const oauthClient = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      )
      oauthClient.setCredentials({
        access_token:  accessToken,
        refresh_token: refreshToken,
      })

      const gmail = google.gmail({ version: 'v1', auth: oauthClient })
      const watchResponse = await gmail.users.watch({
        userId: 'me',
        requestBody: {
          labelIds: ['INBOX'],
          topicName: process.env.GOOGLE_PUBSUB_TOPIC!,
        },
      })

      const newExpiry = new Date(
        Number(watchResponse.data.expiration)
      ).toISOString()

      await supabase
        .from('team_members')
        .update({
          watch_expiry:    newExpiry,
          last_history_id: watchResponse.data.historyId ?? null,
        })
        .eq('id', member.id)

      renewed++
    } catch (err: any) {
      errors.push(`${member.email}: ${err.message}`)
    }
  }

  return { renewed, errors, total: expiring.length }
}
