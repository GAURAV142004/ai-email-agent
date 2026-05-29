import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getServiceSupabase } from '@/lib/auth'
import { safeDecrypt } from '@/lib/crypto'
import { setupGmailWatch } from '@/lib/gmail/watch'

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

      const result = await setupGmailWatch(supabase, member.id, accessToken, refreshToken)
      if (result.ok) {
        renewed++
      } else {
        errors.push(`${member.email}: ${result.error}`)
      }
    } catch (err: any) {
      errors.push(`${member.email}: ${err.message}`)
    }
  }

  return NextResponse.json({ renewed, errors, total: expiring.length })
}
