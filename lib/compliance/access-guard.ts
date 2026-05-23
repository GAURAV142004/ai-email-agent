import { TeamRole } from '@/lib/supabase/types'
import { VISIBILITY_MAP } from '@/lib/roles'
import { detectPersonalTopics } from './topic-detector'

export interface AccessCheckResult {
  allowed: boolean
  blockReason: string | null
  personalTopicsFound: string[]
}

/**
 * Two-layer compliance check for every KB chatbot query:
 *
 * Layer 1 — Visibility: does the viewer's role allow querying
 *            about the target member's role?
 * Layer 2 — Personal topic gate: does the query text contain
 *            personal/sensitive topic patterns?
 *
 * Both layers must pass. Either failure returns allowed=false.
 */
export function checkKBAccess(params: {
  viewerRole: TeamRole
  queryText: string
  targetMemberRole?: TeamRole  // undefined = general team query
}): AccessCheckResult {
  // Layer 1: visibility check
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

  // Layer 2: personal topic check on the query itself
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
