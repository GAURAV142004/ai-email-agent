import { TeamRole } from '@/lib/supabase/types'
import { VISIBILITY_MAP } from '@/lib/roles'
import { detectPersonalTopics } from './topic-detector'

export interface AccessCheckResult {
  allowed: boolean
  blockReason: string | null
  personalTopicsFound: string[]
}

/**
 * Personal-attribute keywords that are almost never legitimate when asked
 * about a named team member. Used as Layer 1.5 between the visibility check
 * and the full pattern-based topic detector.
 *
 * These are intentionally broad because the query is already scoped to a
 * specific person (targetMemberRole is set), so false positives are low.
 */
const NAMED_PERSON_PERSONAL_RX =
  /\b(salary|ctc|package|compensation|stipend|earn|income|pay\b|remuneration|
    age\b|how old|date of birth|dob|birthday|birthdate|
    address|home|house|flat|residence|stay|live|reside|located|from\b|hometown|city\b|
    phone|mobile|contact number|personal email|
    hobbies|interests|lifestyle|habits|passion|
    married|single|divorced|relationship|family|kids|children|wife|husband|girlfriend|boyfriend|
    health|sick|ill|medical|hospital|leave|absent|
    religion|caste|community|faith|sect|
    personal|private|background)\b/i

/**
 * Two-layer compliance check for every KB chatbot query:
 *
 * Layer 1   — Visibility: does the viewer's role allow querying
 *             about the target member's role?
 * Layer 1.5 — Named-person personal-attribute gate: if the query mentions a
 *             known team member AND uses personal-attribute keywords, block it
 *             immediately before the full pattern check.
 * Layer 2   — Personal topic gate: does the query text contain
 *             personal/sensitive topic patterns (broad regex set)?
 *
 * All layers must pass. Any failure returns allowed=false.
 */
export function checkKBAccess(params: {
  viewerRole: TeamRole
  queryText: string
  targetMemberRole?: TeamRole  // undefined = general team query (no named person detected)
}): AccessCheckResult {
  // Layer 1: role visibility check
  if (params.targetMemberRole) {
    const visibleRoles = VISIBILITY_MAP[params.viewerRole]
    if (!visibleRoles.includes(params.targetMemberRole)) {
      return {
        allowed: false,
        blockReason: `Your role does not have visibility into the ${params.targetMemberRole} stream.`,
        personalTopicsFound: [],
      }
    }
  }

  // Layer 1.5: named-person + personal-attribute intent check
  // If the query mentions a known team member (targetMemberRole is set) AND
  // contains personal-attribute keywords, block immediately. This catches
  // natural-language personal questions ("What does Priya earn?",
  // "Where does Rahul live?") that may not match the full pattern set.
  if (params.targetMemberRole && NAMED_PERSON_PERSONAL_RX.test(params.queryText)) {
    return {
      allowed: false,
      blockReason:
        'This query appears to request personal information about a team member. ' +
        'Personal attributes (salary, location, age, health, relationships, etc.) ' +
        'are outside the scope of the project knowledge base.',
      personalTopicsFound: ['named_person_personal_query'],
    }
  }

  // Layer 2: broad personal topic check on the query itself
  const topicCheck = detectPersonalTopics(params.queryText)
  if (topicCheck.hasPersonalTopics) {
    return {
      allowed: false,
      blockReason:
        'This query touches on personal or sensitive topics that are outside the scope ' +
        'of the project knowledge base. The system cannot surface personal information ' +
        'about team members regardless of role.',
      personalTopicsFound: topicCheck.detectedTopics,
    }
  }

  return { allowed: true, blockReason: null, personalTopicsFound: [] }
}

/**
 * Post-generation check: scan AI response for personal topic leakage.
 * If the response somehow contains personal content, block it.
 */
export function checkResponseSafety(responseText: string): AccessCheckResult {
  const topicCheck = detectPersonalTopics(responseText)
  if (topicCheck.hasPersonalTopics) {
    return {
      allowed: false,
      blockReason:
        'The generated response contained personal information and has been blocked ' +
        'to protect employee privacy.',
      personalTopicsFound: topicCheck.detectedTopics,
    }
  }
  return { allowed: true, blockReason: null, personalTopicsFound: [] }
}
