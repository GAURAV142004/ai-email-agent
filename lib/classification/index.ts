import { EmailClassificationRule, ClassificationResult } from '@/lib/supabase/types'
import { applyRules } from './rules-engine'
import { classifyWithAI } from './ai-classifier'

/**
 * Combined classification pipeline.
 * 1. Apply admin-configured rules first (deterministic, free, instant)
 * 2. If no rule matches → always fall back to AI inference (privacy-first prompt)
 *
 * NOTE: We no longer gate AI inference on an explicit "ai_inference" rule.
 * Admin rules are for allowlisting known domains/senders.
 * AI is the intelligent fallback for everything else.
 */
export async function classifyEmail(
  rules: EmailClassificationRule[],
  params: {
    fromEmail: string
    toEmail:   string
    subject:   string
    snippet:   string
  },
): Promise<ClassificationResult> {
  // Step 1: deterministic rule-based check (free, fast)
  const ruleResult = applyRules(rules, params)
  if (ruleResult.matched) {
    return {
      isProjectRelated: true,
      confidence:       1.0,
      reason:           ruleResult.reason!,
      detectedProject:  null,
      source:           'rule',
    }
  }

  // Step 2: AI inference — always called when no rule matches
  // The AI prompt is privacy-first: defaults to NOT project-related when uncertain
  try {
    const aiResult = await classifyWithAI(params)
    return { ...aiResult, source: 'ai' }
  } catch {
    // On Bedrock failure default to NOT project-related (privacy-first)
    return {
      isProjectRelated: false,
      confidence:       0,
      reason:           'AI classification unavailable — defaulting to personal',
      detectedProject:  null,
      source:           'ai',
    }
  }
}

export { applyRules, aiInferenceEnabled } from './rules-engine'
export { classifyWithAI } from './ai-classifier'
