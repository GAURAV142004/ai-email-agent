import { ClassificationRuleType, EmailClassificationRule } from '@/lib/supabase/types'

export interface RuleMatchResult {
  matched: boolean
  matchedRule: EmailClassificationRule | null
  reason: string | null
}

/**
 * Applies admin-configured classification rules to determine if an email
 * is project-related. Rules take priority over AI inference.
 *
 * Rule evaluation order:
 *   1. client_domain  — sender domain matches a known client/vendor domain
 *   2. sender_email   — exact sender email match
 *   3. receiver_email — exact recipient email match
 *   4. subject_keyword — subject contains a tracked keyword
 *   (ai_inference is a flag, not evaluated here)
 */
export function applyRules(
  rules: EmailClassificationRule[],
  params: {
    fromEmail: string
    toEmail: string
    subject: string
  },
): RuleMatchResult {
  const activeRules = rules.filter(r => r.is_active && r.rule_type !== 'ai_inference')

  const fromDomain = extractDomain(params.fromEmail)
  const toDomain   = extractDomain(params.toEmail)

  for (const rule of activeRules) {
    if (!rule.value) continue

    switch (rule.rule_type as ClassificationRuleType) {
      case 'client_domain':
        if (
          fromDomain === rule.value.toLowerCase() ||
          toDomain   === rule.value.toLowerCase()
        ) {
          return {
            matched: true,
            matchedRule: rule,
            reason: `Sender/recipient domain matches client domain "${rule.value}"`,
          }
        }
        break

      case 'sender_email':
        if (params.fromEmail.toLowerCase() === rule.value.toLowerCase()) {
          return {
            matched: true,
            matchedRule: rule,
            reason: `Sender "${params.fromEmail}" is a configured client contact`,
          }
        }
        break

      case 'receiver_email':
        if (params.toEmail.toLowerCase() === rule.value.toLowerCase()) {
          return {
            matched: true,
            matchedRule: rule,
            reason: `Recipient "${params.toEmail}" is a configured project address`,
          }
        }
        break

      case 'subject_keyword':
        if (params.subject.toLowerCase().includes(rule.value.toLowerCase())) {
          return {
            matched: true,
            matchedRule: rule,
            reason: `Subject contains tracked keyword "${rule.value}"`,
          }
        }
        break
    }
  }

  return { matched: false, matchedRule: null, reason: null }
}

/** Returns true if there is at least one active ai_inference rule */
export function aiInferenceEnabled(rules: EmailClassificationRule[]): boolean {
  return rules.some(r => r.is_active && r.rule_type === 'ai_inference')
}

function extractDomain(email: string): string {
  const clean = email.trim().toLowerCase()
  const at = clean.lastIndexOf('@')
  return at !== -1 ? clean.slice(at + 1) : clean
}
