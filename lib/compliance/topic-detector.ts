export interface TopicDetectionResult {
  hasPersonalTopics: boolean
  detectedTopics: string[]
}

/**
 * Detects personal/sensitive topics in a query or response text.
 *
 * Patterns cover both specific keyword combinations AND natural-language
 * personal-intent phrasings (e.g. "What does Rahul earn?", "Where does she live?").
 *
 * Rule of thumb:
 *   - Narrow patterns (require possessives/names) where the topic word is
 *     commonly used in professional contexts (e.g. "health", "address").
 *   - Broader patterns where the topic word is almost always personal
 *     (e.g. "salary", "CTC", "hobbies").
 */
const PERSONAL_TOPIC_PATTERNS: Array<{ topic: string; patterns: RegExp[] }> = [
  // ── Personal Finance ─────────────────────────────────────────────────────────
  {
    topic: 'personal_finance',
    patterns: [
      /\b(salary advance|personal loan|borrow money|lend money)\b/i,
      /\b(credit card bill|credit score|financial trouble|money problem)\b/i,
      /\b(EMI|loan repayment|debt collection)\b/i,
      // Natural-language salary/compensation queries
      /\b(salary|ctc|package|pay|compensation|stipend|take.?home|remuneration|earning)\b.{0,40}\b(of|for|his|her|their|your)\b/i,
      /\bwhat\s+(does|did|is|was)\b.{0,30}\b(earn|make|paid|getting|drawing|taking home|receiving)\b/i,
      /\bhow much\s+(does|did|is|was)\b.{0,30}\b(earn|make|paid|get paid|drawing)\b/i,
      /\b(his|her|their|your)\s+(salary|ctc|package|pay|compensation|stipend|income|earnings)\b/i,
      /\btell me.{0,20}(salary|ctc|package|compensation)\b/i,
    ],
  },

  // ── Health / Medical ─────────────────────────────────────────────────────────
  {
    topic: 'health_medical',
    patterns: [
      /\b(my|his|her|their|your)\s+(health|illness|surgery|treatment|hospital|diagnosis|medicine|condition)\b/i,
      /\b(sick leave|medical leave|health issue|mental health issue|hospitalized|undergoing treatment)\b/i,
      /\b(is|was|has been)\s+(sick|ill|hospitalized|diagnosed|admitted)\b/i,
      /\b(anxiety disorder|depression diagnosis|therapy session|counseling session)\b/i,
      /\bwhy (is|was|has)\b.{0,25}\b(absent|on leave|not coming|not available)\b/i,
    ],
  },

  // ── Personal Relationships ────────────────────────────────────────────────────
  {
    topic: 'personal_relationships',
    patterns: [
      /\b(married|marriage|divorce|engagement|girlfriend|boyfriend|spouse|wife|husband)\b/i,
      /\b(relationship|breakup|dating|affair)\b/i,
      /\b(family problem|domestic issue|personal life)\b/i,
      /\bis\b.{0,20}\b(single|married|engaged|divorced|dating)\b/i,
      /\bwho (is|does).{0,20}\b(live with|married to|dating|seeing)\b/i,
    ],
  },

  // ── Personal Legal ────────────────────────────────────────────────────────────
  {
    topic: 'legal_personal',
    patterns: [
      /\b(court case|legal notice|police complaint|FIR|arrest|bail)\b/i,
      /\b(property dispute|inheritance|will dispute)\b/i,
    ],
  },

  // ── Religion / Caste ─────────────────────────────────────────────────────────
  {
    topic: 'religion_caste',
    patterns: [
      /\b(caste|sect|religion of|temple|mosque|church)\s+(someone|him|her|them|member|employee)\b/i,
      /\bwhat\s+(religion|caste|community|sect)\b.{0,30}\b(is|was|are|does)\b/i,
      /\b(his|her|their)\s+(religion|caste|community|faith|sect)\b/i,
    ],
  },

  // ── Personal Grievance ────────────────────────────────────────────────────────
  {
    topic: 'personal_grievance',
    patterns: [
      /\b(harassment|bullying|personal complaint about|argument with)\b/i,
      /\b(conflict with colleague|personal dispute|fight with)\b/i,
    ],
  },

  // ── Personal Identifiers / Contact Info ──────────────────────────────────────
  {
    topic: 'personal_identifiers',
    patterns: [
      /\b(phone|mobile|cell|telephone|contact)\s+(?:number|no|details|digits|info)\b/i,
      /\b(home address|residential address|living address|house address|personal address)\b/i,
      /\b(date of birth|dob|birth date|birthdate|birthday|age of|how old is|how old (is|was|are))\b/i,
      /\b(aadhaar|aadhar|pan|passport|ssn|social security|national id|voter id|id card|driving license|license number)\b/i,
      /\b(bank account|bank details|account number|ifsc|routing number)\b/i,
      /\b(personal email|private email|gmail address|yahoo address|outlook address)\b/i,
      // Broader location queries about a person
      /\bwhere\s+(does|do|did|is|was)\b.{0,30}\b(live|stay|reside|based|located|from)\b/i,
      /\b(his|her|their)\s+(address|location|home|house|flat|residence|city|area|locality)\b/i,
      // Contact info fishing
      /\b(phone|mobile|contact|number)\b.{0,20}\b(of|for|his|her|their)\b/i,
    ],
  },

  // ── General Personal Intent ───────────────────────────────────────────────────
  // Catches questions that are clearly personal in nature even if they don't
  // fall neatly into the categories above.
  {
    topic: 'general_personal_intent',
    patterns: [
      // "Tell me something personal about X"
      /\b(tell me|share|find out|show me|what (is|are))\b.{0,30}\b(personal|private|personal life|personal details|background info)\b/i,
      // Hobbies / lifestyle
      /\b(hobbies|interests|lifestyle|habits|personal interests|side interests|passion|favourite|favorite)\b.{0,30}\b(of|his|her|their|for)\b/i,
      /\b(his|her|their)\s+(hobbies|interests|lifestyle|habits|passions|favourites|favorites)\b/i,
      // General "about him/her" fishing
      /\btell me (more )?about\s+(him|her|them)\b/i,
      /\bwhat (do you know|can you tell me) about\s+(him|her|them)\b/i,
      // Age in natural language (not covered by personal_identifiers "age of")
      /\bhow old\s+(is|was|are)\b/i,
      /\bwhat('s| is) (his|her|their) age\b/i,
      // Personal background / origin
      /\b(where (is|was) (he|she|they) (from|born)|hometown|birthplace|native place)\b/i,
      // Family info
      /\b(his|her|their)\s+(family|parents|father|mother|siblings|children|kids|son|daughter|brother|sister)\b/i,
      /\b(does|did)\s+\w+\s+(have|has)\s+(kids|children|a wife|a husband|a family|siblings)\b/i,
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
  general_personal_intent: 'General Personal Information Request',
}
