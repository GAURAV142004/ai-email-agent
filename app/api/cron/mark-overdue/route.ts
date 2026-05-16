import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/auth'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceSupabase()
  const slaMinutes = Number(process.env.SLA_RED_MINUTES ?? '1440')
  const cutoff = new Date(Date.now() - slaMinutes * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('email_threads')
    .update({ reply_status: 'overdue' })
    .eq('reply_status', 'pending')
    .lt('received_at', cutoff)
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    marked_overdue: data?.length ?? 0,
    cutoff,
  })
}
