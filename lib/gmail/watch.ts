import { SupabaseClient } from '@supabase/supabase-js'
import { getGmailClient } from './client'

export async function setupGmailWatch(
  supabase: SupabaseClient,
  memberId: string,
  accessToken: string,
  refreshToken?: string
): Promise<{ ok: boolean; watchExpiry: string | null; historyId: string | null; error?: string }> {
  try {
    const gmail = getGmailClient(accessToken, refreshToken)

    const watchRes = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: process.env.GOOGLE_PUBSUB_TOPIC!,
        labelIds:  ['INBOX'],
      },
    })

    const watchExpiry = watchRes.data.expiration
      ? new Date(Number(watchRes.data.expiration)).toISOString()
      : null

    const historyId = watchRes.data.historyId ?? null

    // Persist watch metadata to team_members
    await supabase
      .from('team_members')
      .update({
        watch_expiry:    watchExpiry,
        last_history_id: historyId,
      })
      .eq('id', memberId)

    return { ok: true, watchExpiry, historyId }
  } catch (err: any) {
    console.error(`[setupGmailWatch] Failed for member ${memberId}:`, err)
    return { ok: false, watchExpiry: null, historyId: null, error: err?.message ?? 'Unknown watch setup error' }
  }
}
