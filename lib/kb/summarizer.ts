import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { maskPII } from '@/lib/pii/masker'
import { KBActionItem } from '@/lib/supabase/types'

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0'

export interface KBSummaryResult {
  summary: string
  keyPoints: string[]
  actionItems: KBActionItem[]
  detectedProject: string | null
  participantDomains: string[]
  piiWasMasked: boolean
  tokensUsed: number
}

/**
 * Summarizes an email thread for knowledge-base storage.
 * PII is masked before sending to AI. Raw content is never stored.
 */
export async function summarizeForKB(params: {
  subject: string
  fromEmail: string
  threadText: string  // full concatenated thread body
}): Promise<KBSummaryResult> {
  // Mask PII before sending to AI
  const masked = maskPII(params.threadText.slice(0, 4000))

  const systemPrompt =
    'You are a knowledge-base indexer for a software delivery team. ' +
    'Summarize email threads as structured JSON. Respond with JSON only.'

  const userPrompt = `Summarize this work email thread for a project knowledge base.

Subject: "${params.subject}"
From domain: "${extractDomain(params.fromEmail)}"

Thread content:
${masked.masked}

Rules:
- Focus ONLY on project/work content. Never include personal information.
- key_points: specific facts, decisions, numbers, dates — not generic phrases.
- action_items: ONLY tasks where a specific person or team is explicitly asked to DO something.
  DO NOT create action items for general questions, status updates, or information-sharing emails.
  Each action item must have a clear task verb (fix, update, submit, review, deploy, etc.).
- detected_project: infer from context (client name, project name, system name).

Respond with JSON only:
{
  "summary": "1-2 sentences stating exactly what happened or was decided",
  "key_points": ["specific fact or decision 1", "specific fact or decision 2"],
  "action_items": [
    { "task": "specific task with verb", "owner_hint": "person or team name or null", "due_date_hint": "YYYY-MM-DD or null" }
  ],
  "detected_project": "project name or null",
  "participant_domains": ["domain1.com", "domain2.com"]
}`

  try {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: [{ text: userPrompt }] }],
      system: [{ text: systemPrompt }],
      inferenceConfig: { maxTokens: 600, temperature: 0.1 },
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
    const tokens   = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0)
    const parsed   = JSON.parse(text.replace(/```json|```/g, '').trim())

    return {
      summary:            parsed.summary          ?? params.subject,
      keyPoints:          parsed.key_points        ?? [],
      actionItems:        parsed.action_items      ?? [],
      detectedProject:    parsed.detected_project  ?? null,
      participantDomains: parsed.participant_domains ?? [extractDomain(params.fromEmail)],
      piiWasMasked:       masked.wasMasked,
      tokensUsed:         tokens,
    }
  } catch {
    return {
      summary:            params.subject,
      keyPoints:          [],
      actionItems:        [],
      detectedProject:    null,
      participantDomains: [extractDomain(params.fromEmail)],
      piiWasMasked:       masked.wasMasked,
      tokensUsed:         0,
    }
  }
}

function extractDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at !== -1 ? email.slice(at + 1).toLowerCase() : email.toLowerCase()
}
