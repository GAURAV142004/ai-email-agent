import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { isManagerRole, type TeamRole } from '@/lib/roles'

const SUBORDINATE_ROLES: Partial<Record<string, string[]>> = {
  senior_ba:        ['ba'],
  senior_mis:       ['mis'],
  senior_developer: ['developer'],
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()

  let query = supabase.from('team_member_reports').select('*')
  if (member.role !== 'delivery_lead') {
    query = query.eq('manager_id', member.id)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assignments: data ?? [] })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManagerRole(member.role as TeamRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { member_id } = body
  if (!member_id) {
    return NextResponse.json({ error: 'member_id is required' }, { status: 400 })
  }

  const supabase = getServiceSupabase()

  const { data: target } = await supabase
    .from('team_members')
    .select('id, role, is_active')
    .eq('id', member_id)
    .single()

  if (!target || !target.is_active) {
    return NextResponse.json({ error: 'Member not found or inactive' }, { status: 404 })
  }

  if (member.role !== 'delivery_lead') {
    const allowed = SUBORDINATE_ROLES[member.role] ?? []
    if (!allowed.includes(target.role)) {
      return NextResponse.json(
        { error: `Your role cannot assign a ${target.role} to your team` },
        { status: 403 }
      )
    }
  }

  const { data: assignment, error } = await supabase
    .from('team_member_reports')
    .insert({ member_id, manager_id: member.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assignment }, { status: 201 })
}
