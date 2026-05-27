export interface TopicDetectionResult {
  hasPersonalTopics: boolean
  detectedTopics: string[]
}

/**
 * Detects personal/sensitive topics in a query or response text.
 *
 * Patterns are intentionally narrow — they must indicate a personal context
 * about a specific person, not a professional or project context.
 * e.g. "hospital client project" should NOT match; "his hospital stay" should.
 */
const PERSONAL_TOPIC_PATTERNS: Array<{ topic: string; patterns: RegExp[] }> = [
  {
    topic: 'personal_finance',
    patterns: [
      /\b(salary advance|personal loan|borrow money|lend money)\b/i,
      /\b(credit card bill|credit score|financial trouble|money problem)\b/i,
      /\b(EMI|loan repayment|debt collection)\b/i,
    ],
  },
  {
    topic: 'health_medical',
    patterns: [
      // Require personal possessives or names alongside medical terms
      /\b(my|his|her|their|your)\s+(health|illness|surgery|treatment|hospital|diagnosis|medicine)\b/i,
      /\b(sick leave|medical leave|health issue|mental health issue|hospitalized|undergoing treatment)\b/i,
      /\b(is|was|has been)\s+(sick|ill|hospitalized|diagnosed)\b/i,
      /\b(anxiety disorder|depression diagnosis|therapy session|counseling session)\b/i,
    ],
  },
  {
    topic: 'personal_relationships',
    patterns: [
      /\b(married|marriage|divorce|engagement|girlfriend|boyfriend|spouse|wife|husband)\b/i,
      /\b(relationship|breakup|dating|affair)\b/i,
      /\b(family problem|domestic issue|personal life)\b/i,
    ],
  },
  {
    topic: 'legal_personal',
    patterns: [
      /\b(court case|legal notice|police complaint|FIR|arrest|bail)\b/i,
      /\b(property dispute|inheritance|will dispute)\b/i,
    ],
  },
  {
    topic: 'religion_caste',
    patterns: [
      /\b(caste|sect|religion of|temple|mosque|church)\s+(someone|him|her|them|member|employee)\b/i,
    ],
  },
  {
    topic: 'personal_grievance',
    patterns: [
      /\b(harassment|bullying|personal complaint about|argument with)\b/i,
      /\b(conflict with colleague|personal dispute|fight with)\b/i,
    ],
  },
  {
    topic: 'personal_identifiers',
    patterns: [
      /\b(phone|mobile|contact|cell|telephone)\s*(number|no)?\b/i,
      /\b(home address|residential address|living address|house address)\b/i,
      /\b(date of birth|dob|birth date|birthdate|birthday|age of|how old is)\b/i,
      /\b(aadhaar|aadhar|pan|passport|ssn|social security|national id|voter id|id card|driving license|license number)\b/i,
      /\b(bank account|bank details|account number|ifsc|routing number)\b/i,
      /\b(personal email|private email|gmail address|yahoo address|outlook address)\b/i,
    ],
  },
]

export function detectPersonalTopics(text: string): TopicDetectionResult {
  const found: string[] = []

  for (const { topic, patterns } of PERSONAL_TOPIC_PATTERNS) {
    if (patterns.some(p => p.test(text))) {
      found.push(topic)
    }
  }

  return {
    hasPersonalTopics: found.length > 0,
    detectedTopics:    found,
  }
}

export const TOPIC_LABELS: Record<string, string> = {
  personal_finance:        'Personal Financial Matters',
  health_medical:          'Health & Medical Information',
  personal_relationships:  'Personal Relationships',
  legal_personal:          'Personal Legal Matters',
  religion_caste:          'Religion / Community',
  personal_grievance:      'Personal Grievances',
  personal_identifiers:    'Personal Identifiers / Contact Details',
}
