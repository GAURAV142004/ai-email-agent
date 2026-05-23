import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { CONSENT_VERSION } from '@/lib/email/invite-template'

export async function GET(): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()
  const { data } = await supabase
    .from('team_members')
    .select('consent_given, consent_at, consent_version')
    .eq('id', member.id)
    .single()

  return NextResponse.json({
    consentGiven:   data?.consent_given ?? false,
    consentAt:      data?.consent_at ?? null,
    consentVersion: data?.consent_version ?? null,
    currentVersion: CONSENT_VERSION,
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  if (body?.accepted !== true) {
    return NextResponse.json(
      { error: 'Consent must be explicitly accepted' },
      { status: 400 },
    )
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  const supabase = getServiceSupabase()
  await supabase
    .from('team_members')
    .update({
      consent_given:   true,
      consent_at:      new Date().toISOString(),
      consent_ip:      ip,
      consent_version: CONSENT_VERSION,
    })
    .eq('id', member.id)

  return NextResponse.json({ ok: true, consentVersion: CONSENT_VERSION })
}
