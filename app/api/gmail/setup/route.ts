import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { getGmailClient } from '@/lib/gmail/client'
import { safeDecrypt } from '@/lib/crypto'

export async function GET(): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()
  const { data } = await supabase
    .from('team_members')
    .select('watch_expiry, last_history_id')
    .eq('id', member.id)
    .single()

  return NextResponse.json({
    watch_expiry:    data?.watch_expiry ?? null,
    last_history_id: data?.last_history_id ?? null,
  })
}

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

  const acc = account as { id: string; access_token: string | null; refresh_token: string | null } | null
  if (!acc?.access_token) {
    return NextResponse.json({ error: 'No Gmail account connected' }, { status: 400 })
  }

  const accessToken = safeDecrypt(acc.access_token)
  const refreshToken = acc.refresh_token ? safeDecrypt(acc.refresh_token) : undefined

  try {
    const gmail = getGmailClient(accessToken, refreshToken)

    const watchResponse = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        labelIds: ['INBOX'],
        topicName: process.env.GOOGLE_PUBSUB_TOPIC!,
      },
    })

    const expiry = watchResponse.data.expiration
      ? new Date(parseInt(watchResponse.data.expiration)).toISOString()
      : null

    await supabase
      .from('connected_accounts')
      .update({
        watch_expiry: expiry,
        status: 'active',
        last_history_id: watchResponse.data.historyId ?? null,
      })
      .eq('id', acc.id)

    // Also update team_members so Settings page reflects status immediately
    const member = await getMemberFromSession()
    if (member) {
      await supabase
        .from('team_members')
        .update({
          watch_expiry:    expiry,
          last_history_id: watchResponse.data.historyId ?? null,
        })
        .eq('id', member.id)
    }

    return NextResponse.json({ ok: true, historyId: watchResponse.data.historyId, expiry })
  } catch (err) {
    console.error('Gmail watch setup error:', err)
    return NextResponse.json({ error: 'Failed to set up Gmail watch' }, { status: 500 })
  }
}
