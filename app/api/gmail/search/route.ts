import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { getGmailClient } from '@/lib/gmail/client'
import { safeDecrypt } from '@/lib/crypto'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const from    = searchParams.get('from')
  const to      = searchParams.get('to')
  const subject = searchParams.get('subject')
  const after   = searchParams.get('after')
  const before  = searchParams.get('before')
  const q       = searchParams.get('q')
  const limit   = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50)

  const parts: string[] = []
  if (from)    parts.push(`from:${from}`)
  if (to)      parts.push(`to:${to}`)
  if (subject) parts.push(`subject:${subject}`)
  if (after)   parts.push(`after:${after.replace(/-/g, '/')}`)
  if (before)  parts.push(`before:${before.replace(/-/g, '/')}`)
  if (q)       parts.push(q)

  if (parts.length === 0)
    return NextResponse.json({ error: 'At least one search parameter is required' }, { status: 400 })

  const gmailQuery = parts.join(' ')

  const supabase = getServiceSupabase()
  const { data: tokenRow } = await supabase
    .from('member_gmail_tokens')
    .select('access_token, refresh_token')
    .eq('member_id', member.id)
    .single()

  if (!tokenRow?.access_token)
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })

  const accessToken  = safeDecrypt(tokenRow.access_token)
  const refreshToken = tokenRow.refresh_token ? safeDecrypt(tokenRow.refresh_token) : undefined

  const gmail = getGmailClient(accessToken, refreshToken)

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: gmailQuery,
    maxResults: limit,
  })

  const messages = listRes.data.messages ?? []
  const total    = listRes.data.resultSizeEstimate ?? 0

  const emails = await Promise.all(
    messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'METADATA',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      })
      const headers  = detail.data.payload?.headers ?? []
      const getH     = (name: string) =>
        headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

      return {
        id:        msg.id,
        threadId:  msg.threadId,
        subject:   getH('Subject') || '(No subject)',
        from:      getH('From'),
        to:        getH('To'),
        date:      getH('Date'),
        snippet:   detail.data.snippet ?? '',
        gmailLink: `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`,
      }
    })
  )

  return NextResponse.json({ emails, total, query: gmailQuery })
}
