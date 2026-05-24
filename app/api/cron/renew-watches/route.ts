import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getServiceSupabase } from '@/lib/auth'
import { google } from 'googleapis'
import { safeDecrypt } from '@/lib/crypto'

function verifyCronSecret(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !authHeader) return false
  const expected = `Bearer ${secret}`
  if (authHeader.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceSupabase()

  // Find members whose watch expires in < 2 days
  const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()

  const { data: expiring } = await supabase
    .from('team_members')
    .select('id, email')
    .lt('watch_expiry', twoDaysFromNow)
    .eq('is_active', true)

  if (!expiring || expiring.length === 0) {
    return NextResponse.json({ renewed: 0, message: 'No watches expiring soon' })
  }

  let renewed = 0
  const errors: string[] = []

  for (const member of expiring) {
    try {
      // Resolve tokens: member_gmail_tokens first, connected_accounts as fallback
      let accessToken: string | null = null
      let refreshToken: string | null = null

      const { data: memberTokens } = await supabase
        .from('member_gmail_tokens')
        .select('access_token, refresh_token')
        .eq('member_id', member.id)
        .single()

      if (memberTokens) {
        accessToken  = safeDecrypt((memberTokens as any).access_token)
        refreshToken = (memberTokens as any).refresh_token
          ? safeDecrypt((memberTokens as any).refresh_token)
          : null
      } else {
        continue // no tokens — skip
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

  return NextResponse.json({ renewed, errors, total: expiring.length })
}
