import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { VISIBILITY_MAP, ROLE_LABELS, isManagerRole, type TeamRole } from '@/lib/roles'
import { sendInviteEmail } from '@/lib/email/sender'
import { z } from 'zod'

const SELECT_FIELDS =
  'id, name, email, role, avatar_url, is_active, watch_expiry, created_at, supabase_uid'

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getServiceSupabase()

  // delivery_lead sees all members (including inactive) for Manage Users
  // manager roles see all members in their visible role pool (VISIBILITY_MAP)
  //   so Add Member dropdown can show eligible subordinates
  // individual contributors see only themselves
  let query
  if (member.role === 'delivery_lead') {
    query = supabase
      .from('team_members')
      .select(SELECT_FIELDS)
      .order('name')
  } else if (isManagerRole(member.role as TeamRole)) {
    const potentialRoles = VISIBILITY_MAP[member.role as TeamRole]
    query = supabase
      .from('team_members')
      .select(SELECT_FIELDS)
      .in('role', potentialRoles)
      .eq('is_active', true)
      .order('name')
  } else {
    query = supabase
      .from('team_members')
      .select(SELECT_FIELDS)
      .eq('id', member.id)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrich each member with their primary manager_id from the junction table
  const memberIds = (data ?? []).map((m: any) => m.id as string)
  const { data: assignments } = memberIds.length > 0
    ? await supabase
        .from('team_member_reports')
        .select('member_id, manager_id')
        .in('member_id', memberIds)
    : { data: [] }

  const managerMap = new Map<string, string>()
  for (const a of (assignments ?? [])) {
    if (!managerMap.has(a.member_id)) managerMap.set(a.member_id, a.manager_id)
  }

  const members = (data ?? []).map((m: any) => ({
    ...m,
    manager_id: managerMap.get(m.id) ?? null,
  }))

  return NextResponse.json({ members })
}

// Roles allowed to create members, and which target roles they may create
const ALLOWED_ROLES_BY_ADDER: Record<string, string[]> = {
  delivery_lead:    ['senior_ba', 'senior_mis', 'senior_developer', 'ba', 'mis', 'developer'],
  senior_ba:        ['ba'],
  senior_mis:       ['mis'],
  senior_developer: ['developer'],
}

const createMemberSchema = z.object({
  name:       z.string().min(2),
  email:      z.string().email(),
  role:       z.enum([
    'delivery_lead', 'senior_ba', 'senior_mis', 'senior_developer',
    'ba', 'mis', 'developer',
  ]),
  manager_id: z.string().uuid().optional().nullable(),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const allowedAdderRoles = Object.keys(ALLOWED_ROLES_BY_ADDER)
  if (!allowedAdderRoles.includes(member.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = createMemberSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { name, email, role, manager_id } = parsed.data

  // Enforce role hierarchy: adder can only create roles they're permitted to
  const allowedTargetRoles = ALLOWED_ROLES_BY_ADDER[member.role] ?? []
  if (!allowedTargetRoles.includes(role)) {
    return NextResponse.json(
      { error: `Cannot create a member with role ${role}` },
      { status: 403 }
    )
  }

  const orgDomain = process.env.ORG_DOMAIN
  if (orgDomain && !email.endsWith(`@${orgDomain}`)) {
    return NextResponse.json(
      { error: `Email must be a @${orgDomain} address` },
      { status: 400 }
    )
  }

  const supabase = getServiceSupabase()

  const { data: existing } = await supabase
    .from('team_members')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'A team member with this email already exists' },
      { status: 409 }
    )
  }

  const { data: newMember, error } = await supabase
    .from('team_members')
    .insert({ name, email, role, is_active: true })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-assign: senior roles automatically become the new member's manager
  const seniorRoles = ['senior_ba', 'senior_mis', 'senior_developer']
  if (seniorRoles.includes(member.role)) {
    await supabase
      .from('team_member_reports')
      .upsert(
        { member_id: newMember.id, manager_id: member.id },
        { onConflict: 'member_id,manager_id', ignoreDuplicates: true }
      )
  }

  // delivery_lead with explicit manager_id → create that assignment
  if (member.role === 'delivery_lead' && manager_id) {
    await supabase
      .from('team_member_reports')
      .upsert(
        { member_id: newMember.id, manager_id },
        { onConflict: 'member_id,manager_id', ignoreDuplicates: true }
      )
  }

  // Fire-and-forget invite email
  const invitedBy = member.name ?? member.email
  sendInviteEmail({
    toEmail:       email,
    toName:        name,
    invitedByName: invitedBy,
    role:          ROLE_LABELS[role as TeamRole] ?? role,
  }).then(result => {
    if (!result.success) console.error('Invite email failed:', result.error)
  })

  return NextResponse.json({ member: newMember }, { status: 201 })
}
