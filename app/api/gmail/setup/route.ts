import { NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { safeDecrypt } from '@/lib/crypto'
import { setupGmailWatch } from '@/lib/gmail/watch'

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

  const result = await setupGmailWatch(supabase, member.id, accessToken, refreshToken)
  if (result.ok) {
    return NextResponse.json({ ok: true, watchExpiry: result.watchExpiry, historyId: result.historyId })
  } else {
    return NextResponse.json({ error: result.error ?? 'Failed to set up Gmail watch' }, { status: 500 })
  }
}
