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
  detectedProjectConfidence: number   // 0–1; used to decide if we should accept the detected project
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
  threadText: string           // full concatenated thread body
  existingProjects?: string[]  // known project names for consistent grouping
}): Promise<KBSummaryResult> {
  // Mask PII before sending to AI
  const masked = maskPII(params.threadText.slice(0, 4000))

  const systemPrompt =
    'You are a knowledge-base indexer for a software delivery team. ' +
    'Summarize email threads as structured JSON. Respond with JSON only. ' +
    'Be highly accurate about project name detection — this is used to group all related emails together.'

  const userPrompt = `Summarize this work email thread for a project knowledge base.

Subject: "${params.subject}"
From domain: "${extractDomain(params.fromEmail)}"
${params.existingProjects?.length ? `Known projects in the system: ${params.existingProjects.join(', ')}` : ''}

Thread content:
${masked.masked}

Rules:
- Focus ONLY on project/work content. Never include personal information.
- key_points: specific facts, decisions, numbers, dates, SLAs, milestones — NOT generic phrases like "discussed the project".
  Bad example: "Team discussed the issue." Good example: "UAT deadline moved to 15 June due to API delays."
- action_items: ONLY tasks where a specific person or team is explicitly asked to DO something.
  DO NOT create action items for general questions, status updates, or information-sharing emails.
  Each action item MUST have a clear task verb (fix, update, submit, review, deploy, approve, etc.).
- detected_project: This is CRITICAL. Infer from:
    1. Client company name mentioned in the email body or subject (e.g. "Infosys", "TCS", "HDFC")
    2. Project/system/product name mentioned (e.g. "Portal Migration", "API Integration", "CRM Upgrade")
    3. Project code or abbreviation (e.g. "PRJ-007", "OMEGA")
    4. If the subject explicitly names a project, prefer that.
    5. If the from-domain matches a known client (e.g. infosys.com → "Infosys"), use that.
    6. If multiple project names appear, pick the most prominent one.
    7. If this is clearly an internal team email with no client/project context, return null.
  IMPORTANT: If the email is related to a project already in the known projects list above,
  use exactly that project name so emails get grouped correctly.
- detected_project_confidence: A score from 0.0 to 1.0 of how confident you are about the project name.
  1.0 = project name explicitly stated; 0.5 = inferred from context; 0.0 = no idea.

Respond with JSON only:
{
  "summary": "1-2 sentences stating exactly what happened or was decided — be specific",
  "key_points": ["specific fact or decision 1", "specific fact or decision 2"],
  "action_items": [
    { "task": "specific task with verb", "owner_hint": "person or team name or null", "due_date_hint": "YYYY-MM-DD or null" }
  ],
  "detected_project": "project name or null",
  "detected_project_confidence": 0.0,
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
      summary:                   parsed.summary                     ?? params.subject,
      keyPoints:                 parsed.key_points                   ?? [],
      actionItems:               parsed.action_items                 ?? [],
      detectedProject:           parsed.detected_project             ?? null,
      detectedProjectConfidence: parsed.detected_project_confidence  ?? 0.5,
      participantDomains:        parsed.participant_domains          ?? [extractDomain(params.fromEmail)],
      piiWasMasked:              masked.wasMasked,
      tokensUsed:                tokens,
    }
  } catch {
    return {
      summary:                   params.subject,
      keyPoints:                 [],
      actionItems:               [],
      detectedProject:           null,
      detectedProjectConfidence: 0,
      participantDomains:        [extractDomain(params.fromEmail)],
      piiWasMasked:              masked.wasMasked,
      tokensUsed:                0,
    }
  }
}

function extractDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at !== -1 ? email.slice(at + 1).toLowerCase() : email.toLowerCase()
}
