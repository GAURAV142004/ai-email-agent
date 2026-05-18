export interface PreFilterResult {
  skip: boolean
  reason: string | null
}

const AUTOMATED_SENDER_PATTERNS = [
  /noreply/i, /no-reply/i, /donotreply/i,
  /do-not-reply/i, /notifications?@/i,
  /alerts?@/i, /automated@/i, /mailer@/i,
  /newsletter@/i, /updates?@/i, /bounce@/i,
  /postmaster@/i, /daemon@/i,
  /support@.*\.(freshdesk|zendesk|intercom)\.com/i,
]

const SKIP_SUBJECT_PATTERNS = [
  /unsubscribe/i, /newsletter/i,
  /\[automated\]/i, /\[notification\]/i,
  /invoice #/i, /receipt for/i,
  /order confirmation/i, /your order/i,
  /shipment/i, /out of office/i,
  /auto[- ]?reply/i, /automatic reply/i,
  /\[jira\]/i, /\[github\]/i,
  /build (passed|failed)/i,
  /transaction alert/i,
  /payment (received|confirmation)/i,
]

const SKIP_BODY_PATTERNS = [
  /this is an automated (email|message)/i,
  /do not reply to this email/i,
  /please do not reply/i,
  /you are receiving this.*because/i,
  /to unsubscribe/i,
]

export function shouldSkipAIAnalysis(
  fromEmail:   string,
  subject:     string,
  bodySnippet: string,
): PreFilterResult {
  for (const p of AUTOMATED_SENDER_PATTERNS)
    if (p.test(fromEmail))
      return { skip: true, reason: 'automated_sender' }
  for (const p of SKIP_SUBJECT_PATTERNS)
    if (p.test(subject))
      return { skip: true, reason: 'skip_subject' }
  for (const p of SKIP_BODY_PATTERNS)
    if (p.test(bodySnippet))
      return { skip: true, reason: 'automated_body' }
  return { skip: false, reason: null }
}
