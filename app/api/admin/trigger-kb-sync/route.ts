import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getServiceSupabase } from '@/lib/auth'
import { indexEmailToKB } from '@/lib/kb/indexer'
import { fetchThread, fetchNewMessages } from '@/lib/gmail/thread'
import { safeDecrypt } from '@/lib/crypto'

export async function POST(): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = (session.user as any)
  if (member?.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden — delivery_lead only' }, { status: 403 })
  }

  // Delegate to the cron route logic by calling it with the internal secret
  const res = await fetch(
    `${process.env.NEXTAUTH_URL}/api/cron/kb-sync`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }
  )
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
