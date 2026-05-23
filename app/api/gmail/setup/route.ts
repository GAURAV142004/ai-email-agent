import { NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { getGmailClient } from '@/lib/gmail/client'
import { safeDecrypt } from '@/lib/crypto'

// GET — return current watch status for the authenticated member
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
    watch_expiry:    data?.watch_expiry    ?? null,
    last_history_id: data?.last_history_id ?? null,
  })
}

// POST — set up (or renew) Gmail push watch for the authenticated member
export async function POST(): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()

  // Load Gmail tokens from member_gmail_tokens
  const { data: tokenRow, error: tokenError } = await supabase
    .from('member_gmail_tokens')
    .select('access_token, refresh_token')
    .eq('member_id', member.id)
    .single()

  if (tokenError || !tokenRow?.access_token) {
    return NextResponse.json(
      { error: 'No Gmail tokens found. Please sign out and sign in again.' },
      { status: 400 }
    )
  }

  const accessToken  = safeDecrypt(tokenRow.access_token)
  const refreshToken = tokenRow.refresh_token ? safeDecrypt(tokenRow.refresh_token) : undefined

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
      .eq('id', member.id)

    return NextResponse.json({ ok: true, watchExpiry, historyId })
  } catch (err) {
    console.error('[Gmail Setup] Watch registration failed:', err)
    return NextResponse.json({ error: 'Failed to set up Gmail watch' }, { status: 500 })
  }
}
