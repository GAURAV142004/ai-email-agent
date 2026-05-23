import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import type { ClassificationRuleType } from '@/lib/supabase/types'

const VALID_RULE_TYPES: ClassificationRuleType[] = [
  'client_domain',
  'sender_email',
  'receiver_email',
  'subject_keyword',
  'ai_inference',
]

// ── GET — list all classification rules (delivery_lead only) ──────────────────
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (member.role !== 'delivery_lead') {
    return NextResponse.json({ error: 'Forbidden: delivery_lead role required' }, { status: 403 })
  }

  const supabase = getServiceSupabase()

  const { data: rules, error } = await supabase
    .from('email_classification_rules')
    .select('*')
    .order('rule_type', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rules: rules ?? [] })
}

// ── POST — create a new classification rule (delivery_lead only) ──────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
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

  const { rule_type, value, description } = body as {
    rule_type?:   string
    value?:       string | null
    description?: string | null
  }

  // Validate rule_type
  if (!rule_type || !VALID_RULE_TYPES.includes(rule_type as ClassificationRuleType)) {
    return NextResponse.json(
      { error: `Invalid rule_type. Must be one of: ${VALID_RULE_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const ruleType = rule_type as ClassificationRuleType

  // ai_inference rules must have a null value; all other types require a non-empty value
  if (ruleType === 'ai_inference') {
    if (value !== null && value !== undefined && value !== '') {
      return NextResponse.json(
        { error: 'value must be null (or omitted) for ai_inference rules' },
        { status: 400 },
      )
    }
  } else {
    if (!value || typeof value !== 'string' || value.trim() === '') {
      return NextResponse.json(
        { error: `value is required and must be a non-empty string for rule_type "${ruleType}"` },
        { status: 400 },
      )
    }
  }

  const supabase = getServiceSupabase()

  const { data, error } = await supabase
    .from('email_classification_rules')
    .insert({
      rule_type:   ruleType,
      value:       ruleType === 'ai_inference' ? null : value!.trim(),
      description: description?.trim() ?? null,
      is_active:   true,
      created_by:  member.id,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rule: data }, { status: 201 })
}
