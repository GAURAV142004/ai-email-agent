import { NextResponse }                          from 'next/server'
import { getConsentedMember, getServiceSupabase } from '@/lib/auth'
import { VISIBILITY_MAP }                         from '@/lib/roles'

export async function GET(): Promise<NextResponse> {
  const member = await getConsentedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase    = getServiceSupabase()
  const visibleRoles = VISIBILITY_MAP[member.role]

  const { data: visibleMembers } = await supabase
    .from('team_members')
    .select('id')
    .in('role', visibleRoles)
    .eq('is_active', true)

  const memberIds = (visibleMembers ?? []).map((m: any) => m.id)
  if (memberIds.length === 0) return NextResponse.json({ projects: [] })

  const { data: rows } = await supabase
    .from('email_knowledge_base')
    .select('detected_project')
    .in('owner_member_id', memberIds)
    .not('detected_project', 'is', null)
    .order('email_date', { ascending: false })
    .limit(500)

  const projects = [
    ...new Set((rows ?? []).map((r: any) => r.detected_project as string).filter(Boolean)),
  ].sort()

  return NextResponse.json({ projects })
}
