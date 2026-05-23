import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'

type RouteContext = { params: Promise<{ id: string }> }

// ── PATCH — update a classification rule (delivery_lead only) ─────────────────
export async function PATCH(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params

  const member = await getMemberFromSession()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (member.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden: delivery_lead role required' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { value, description, is_active } = body as {
    value?:       string | null
    description?: string | null
    is_active?:   boolean
  }

  if (value === undefined && description === undefined && is_active === undefined) {
    return NextResponse.json(
      { error: 'Provide at least one field to update: value, description, or is_active' },
      { status: 400 },
    )
  }

  // Fetch the existing rule to enforce value constraints per rule_type
  const supabase = getServiceSupabase()

  const { data: existing, error: fetchError } = await supabase
    .from('email_classification_rules')
    .select('id, rule_type')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  // Enforce the ai_inference / value constraint if value is being updated
  if (value !== undefined) {
    if (existing.rule_type === 'ai_inference') {
      if (value !== null && value !== '') {
        return NextResponse.json(
          { error: 'value must be null for ai_inference rules' },
          { status: 400 },
        )
      }
    } else {
      if (!value || typeof value !== 'string' || value.trim() === '') {
        return NextResponse.json(
          { error: 'value must be a non-empty string for this rule_type' },
          { status: 400 },
        )
      }
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (value       !== undefined) updates.value       = existing.rule_type === 'ai_inference' ? null : value?.trim() ?? null
  if (description !== undefined) updates.description = description?.trim() ?? null
  if (is_active   !== undefined) updates.is_active   = is_active

  const { data, error } = await supabase
    .from('email_classification_rules')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  return NextResponse.json({ rule: data })
}

// ── DELETE — delete a classification rule (delivery_lead only) ────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params

  const member = await getMemberFromSession()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (member.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden: delivery_lead role required' }, { status: 403 })
  }

  const supabase = getServiceSupabase()

  const { error, count } = await supabase
    .from('email_classification_rules')
    .delete({ count: 'exact' })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (count === 0) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
