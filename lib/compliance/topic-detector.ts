export interface TopicDetectionResult {
  hasPersonalTopics: boolean
  detectedTopics: string[]
}

/**
 * Detects personal/sensitive topics in a query or response text.
 * Used to block higher-hierarchy users from surfacing personal information
 * about their subordinates via the chatbot.
 *
 * Covers: financial personal matters, health, relationships, legal (personal),
 * religion, family issues, and personal grievances.
 */

const PERSONAL_TOPIC_PATTERNS: Array<{ topic: string; patterns: RegExp[] }> = [
  {
    topic: 'personal_finance',
    patterns: [
      /\b(loan|loans|borrow|lend|debt|emi|owe|salary advance|personal loan)\b/i,
      /\b(credit card bill|credit score|financial trouble|money problem)\b/i,
      /\b(bank account|fd|fixed deposit|insurance claim)\b/i,
    ],
  },
  {
    topic: 'health_medical',
    patterns: [
      /\b(medical|hospital|doctor|treatment|surgery|medicine|diagnosis|illness)\b/i,
      /\b(health issue|sick|leave due to|sick leave|medical leave|covid|quarantine)\b/i,
      /\b(mental health|anxiety|depression|therapy|counseling)\b/i,
    ],
  },
  {
    topic: 'personal_relationships',
    patterns: [
      /\b(married|marriage|divorce|engagement|girlfriend|boyfriend|spouse|wife|husband)\b/i,
      /\b(relationship|breakup|dating|affair|personal life)\b/i,
      /\b(family problem|domestic|personal issue)\b/i,
    ],
  },
  {
    topic: 'legal_personal',
    patterns: [
      /\b(court case|legal notice|police|FIR|arrest|bail|lawsuit personal)\b/i,
      /\b(property dispute|inheritance|will|testament)\b/i,
    ],
  },
  {
    topic: 'religion_caste',
    patterns: [
      /\b(religion|caste|community|sect|temple|mosque|church|prayer|fasting)\b/i,
      /\b(hindu|muslim|christian|sikh|buddhist|jain)\b/i,
    ],
  },
  {
    topic: 'personal_grievance',
    patterns: [
      /\b(complained about|personal complaint|harassment|bullying|argument with)\b/i,
      /\b(conflict with colleague|personal dispute|fight with)\b/i,
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
    detectedTopics: found,
  }
}

/** Friendly label for a topic key */
export const TOPIC_LABELS: Record<string, string> = {
  personal_finance:     'Personal Financial Matters',
  health_medical:       'Health & Medical Information',
  personal_relationships: 'Personal Relationships',
  legal_personal:       'Personal Legal Matters',
  religion_caste:       'Religion / Community',
  personal_grievance:   'Personal Grievances',
}
