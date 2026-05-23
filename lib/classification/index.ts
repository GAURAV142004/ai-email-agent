import { EmailClassificationRule, ClassificationResult } from '@/lib/supabase/types'
import { applyRules, aiInferenceEnabled } from './rules-engine'
import { classifyWithAI } from './ai-classifier'

/**
 * Combined classification pipeline.
 * 1. Apply admin-configured rules (deterministic, free)
 * 2. If no rule matches and AI inference is enabled → call Bedrock
 * 3. Default: not project-related (privacy-first)
 */
export async function classifyEmail(
  rules: EmailClassificationRule[],
  params: {
    fromEmail: string
    toEmail: string
    subject: string
    snippet: string
  },
): Promise<ClassificationResult> {
  // Step 1: rule-based
  const ruleResult = applyRules(rules, params)
  if (ruleResult.matched) {
    return {
      isProjectRelated: true,
      confidence: 1.0,
      reason: ruleResult.reason!,
      detectedProject: null,
      source: 'rule',
    }
  }

  // Step 2: AI inference (if enabled)
  if (aiInferenceEnabled(rules)) {
    const aiResult = await classifyWithAI(params)
    // Combine source tag if both were used
    return { ...aiResult, source: 'ai' }
  }

  // Step 3: default — not project-related
  return {
    isProjectRelated: false,
    confidence: 1.0,
    reason: 'No matching rule and AI inference is disabled',
    detectedProject: null,
    source: 'rule',
  }
}

export { applyRules, aiInferenceEnabled } from './rules-engine'
export { classifyWithAI } from './ai-classifier'
