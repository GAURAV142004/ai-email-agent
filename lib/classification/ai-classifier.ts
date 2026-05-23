import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { ClassificationResult } from '@/lib/supabase/types'

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0'

/**
 * Uses AI to classify whether an email is project-related or personal.
 * Only called when no admin rule matches and ai_inference is enabled.
 *
 * Returns isProjectRelated=false with low confidence for ambiguous emails
 * so they are NOT added to the shared knowledge base (privacy-first default).
 */
export async function classifyWithAI(params: {
  subject: string
  fromEmail: string
  snippet: string   // first 500 chars of body
}): Promise<ClassificationResult> {
  const prompt = buildClassificationPrompt(params)

  try {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      system: [{
        text:
          'You are an email classifier for a software delivery company. ' +
          'Respond with valid JSON only. No markdown.',
      }],
      inferenceConfig: { maxTokens: 150, temperature: 0 },
    })

    const command = new InvokeModelCommand({
      modelId:     MODEL_ID,
      contentType: 'application/json',
      accept:      'application/json',
      body:        Buffer.from(body),
    })

    const response = await bedrock.send(command)
    const result   = JSON.parse(Buffer.from(response.body).toString('utf-8'))
    const text     = result.output?.message?.content?.[0]?.text ?? ''
    const parsed   = JSON.parse(text.replace(/```json|```/g, '').trim())

    return {
      isProjectRelated: parsed.is_project_related === true,
      confidence:       clamp(parsed.confidence ?? 0.5),
      reason:           parsed.reason ?? 'AI classification',
      detectedProject:  parsed.detected_project ?? null,
      source:           'ai',
    }
  } catch {
    // On any error default to NOT project-related (privacy-first)
    return {
      isProjectRelated: false,
      confidence:       0,
      reason:           'Classification failed — defaulting to personal',
      detectedProject:  null,
      source:           'ai',
    }
  }
}

function buildClassificationPrompt(params: {
  subject: string
  fromEmail: string
  snippet: string
}): string {
  return `Classify this email as project-related (work/client/vendor communication) or personal.

Subject: "${params.subject}"
From: "${params.fromEmail}"
Body snippet: "${params.snippet.slice(0, 400)}"

Rules:
- Project-related: client communications, project updates, deliverables, technical issues,
  vendor/partner emails, meeting requests about work, status reports, document sharing for work.
- Personal: loans, health, family matters, personal finance, religion, relationships,
  personal shopping, social events unrelated to work, medical, legal personal issues.
- When unsure, classify as NOT project-related (privacy-first).

Respond with JSON:
{
  "is_project_related": true|false,
  "confidence": 0.0-1.0,
  "reason": "one sentence explanation",
  "detected_project": "project name if identifiable, else null"
}`
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n))
}
