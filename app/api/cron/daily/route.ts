import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/auth'
import { google } from 'googleapis'
import { safeDecrypt } from '@/lib/crypto'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceSupabase()
  const results: Record<string, unknown> = {}

  // ── Job 1: Mark overdue threads ──────────────────────
  try {
    const slaMinutes = Number(process.env.SLA_RED_MINUTES ?? '1440')
    const cutoff = new Date(
      Date.now() - slaMinutes * 60 * 1000
    ).toISOString()

    const { data: overdue } = await supabase
      .from('email_threads')
      .update({ reply_status: 'overdue' })
      .eq('reply_status', 'pending')
      .lt('received_at', cutoff)
      .select('id')

    results.marked_overdue = overdue?.length ?? 0
  } catch (err) {
    results.overdue_error = err instanceof Error
      ? err.message : 'Unknown'
  }

  // ── Job 2: Renew expiring Gmail watches ──────────────
  try {
    const twoDaysFromNow = new Date(
      Date.now() + 2 * 24 * 60 * 60 * 1000
    ).toISOString()

    const { data: expiring } = await supabase
      .from('team_members')
      .select('id, email')
      .lt('watch_expiry', twoDaysFromNow)
      .eq('is_active', true)

    let renewed = 0
    const renewErrors: string[] = []

    for (const member of expiring ?? []) {
      try {
        // Try member_gmail_tokens first
        let accessToken: string | null = null
        let refreshToken: string | null = null

        const { data: memberToken } = await supabase
          .from('member_gmail_tokens')
          .select('access_token, refresh_token')
          .eq('member_id', member.id)
          .single()

        if (memberToken) {
          accessToken  = safeDecrypt(memberToken.access_token)
          refreshToken = safeDecrypt(memberToken.refresh_token)
        } else {
          const { data: account } = await supabase
            .from('connected_accounts')
            .select('access_token, refresh_token')
            .eq('email', member.email)
            .eq('status', 'active')
            .single()
          if (account) {
            accessToken  = safeDecrypt(account.access_token)
            refreshToken = safeDecrypt(account.refresh_token)
          }
        }

        if (!accessToken || !refreshToken) continue

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
            labelIds:  ['INBOX'],
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
      } catch (err) {
        renewErrors.push(
          `${member.email}: ${err instanceof Error ? err.message : 'Unknown'}`
        )
      }
    }

    results.watches_renewed = renewed
    results.watch_errors    = renewErrors
  } catch (err) {
    results.renew_error = err instanceof Error
      ? err.message : 'Unknown'
  }

  return NextResponse.json({
    success: true,
    ran_at: new Date().toISOString(),
    ...results
  })
}
