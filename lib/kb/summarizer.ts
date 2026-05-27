import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { maskPII } from '@/lib/pii/masker'
import { KBActionItem, KBBlocker } from '@/lib/supabase/types'

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0'

export interface KBSummaryResult {
  summary:                    string
  keyPoints:                  string[]
  actionItems:                KBActionItem[]
  blockers:                   KBBlocker[]       // NEW: impediments blocking progress
  awaitingResponseFrom:       string | null     // NEW: who we're waiting on for reply
  decisionsMade:              string[]          // NEW: approvals/sign-offs recorded
  emailType:                  string            // NEW: semantic type of this email
  urgency:                    'high' | 'medium' | 'low'  // NEW
  mentionedResponsiblePersons: string[]         // NEW: names called out as responsible
  detectedProject:            string | null
  detectedProjectConfidence:  number
  participantDomains:         string[]
  piiWasMasked:               boolean
  tokensUsed:                 number
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
- key_points: specific facts, decisions, numbers, dates, SLAs, milestones.
  Bad: "Team discussed the issue."  Good: "UAT deadline moved to 15 June due to API delays."
- action_items: tasks where a specific person/team is EXPLICITLY asked to DO something.
  DO NOT invent action items for status updates or information-sharing.
  Each must have a clear verb (fix, submit, review, deploy, approve, etc.).
  priority = high if deadline is near or client is waiting; otherwise medium/low.
- blockers: explicit impediments preventing progress.
  Only include if something IS blocking (not just a concern or risk).
  "blocking_whom" = who/what is stuck; "needs_action_from" = who must unblock.
- awaiting_response_from: name or organisation we sent something to and are STILL waiting
  on a reply/approval. null if the thread is not waiting on anyone.
- decisions_made: concrete decisions, approvals, sign-offs that were CONFIRMED in this thread.
  E.g. "SLA extended to 30 days", "Client approved UAT sign-off on 12 May".
- email_type: classify this thread into exactly ONE of:
    action_request  – someone is asked to do something
    status_update   – progress/update report, no new tasks
    blocker         – primarily reporting an impediment
    decision        – an approval or decision is made/confirmed
    follow_up       – chasing an earlier request or awaiting response
    information     – informational only, no actions
    meeting         – meeting invite, agenda, or minutes
    other           – none of the above
- urgency: high = client escalation / hard deadline within 48h; low = informational; else medium.
- mentioned_responsible_persons: FIRST NAMES or FULL NAMES explicitly mentioned in the body
  as responsible for something (e.g. "Rahul please fix", "ask Priya to review").
  Extract only names clearly linked to a responsibility. Max 5 names.
- detected_project: CRITICAL — infer from:
    1. Client company name in body or subject (e.g. "Infosys", "TCS", "HDFC")
    2. Project/system/product name (e.g. "Portal Migration", "API Integration")
    3. Project code (e.g. "PRJ-007")
    4. From-domain matching a known client (e.g. infosys.com → "Infosys")
    If multiple, pick the most prominent.
    If clearly internal with no client/project context, return null.
  IMPORTANT: If related to a project already in the known list, use EXACTLY that project name.
- detected_project_confidence: 1.0 = explicitly stated; 0.5 = inferred; 0.0 = no idea.

Respond with JSON only — no markdown fences:
{
  "summary": "1-2 sentences — exactly what happened or was decided",
  "key_points": ["specific fact 1", "specific fact 2"],
  "action_items": [
    { "task": "verb + task", "owner_hint": "name or null", "due_date_hint": "YYYY-MM-DD or null", "priority": "high|medium|low" }
  ],
  "blockers": [
    { "description": "what is blocking", "blocking_whom": "who is stuck or null", "needs_action_from": "who must act or null" }
  ],
  "awaiting_response_from": "name/org or null",
  "decisions_made": ["decision 1", "decision 2"],
  "email_type": "action_request|status_update|blocker|decision|follow_up|information|meeting|other",
  "urgency": "high|medium|low",
  "mentioned_responsible_persons": ["FirstName", "FullName"],
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
      summary:                    parsed.summary                       ?? params.subject,
      keyPoints:                  parsed.key_points                     ?? [],
      actionItems:                parsed.action_items                   ?? [],
      blockers:                   parsed.blockers                       ?? [],
      awaitingResponseFrom:       parsed.awaiting_response_from         ?? null,
      decisionsMade:              parsed.decisions_made                 ?? [],
      emailType:                  parsed.email_type                     ?? 'information',
      urgency:                    parsed.urgency                        ?? 'medium',
      mentionedResponsiblePersons: parsed.mentioned_responsible_persons ?? [],
      detectedProject:            parsed.detected_project               ?? null,
      detectedProjectConfidence:  parsed.detected_project_confidence    ?? 0.5,
      participantDomains:         parsed.participant_domains            ?? [extractDomain(params.fromEmail)],
      piiWasMasked:               masked.wasMasked,
      tokensUsed:                 tokens,
    }
  } catch {
    return {
      summary:                    params.subject,
      keyPoints:                  [],
      actionItems:                [],
      blockers:                   [],
      awaitingResponseFrom:       null,
      decisionsMade:              [],
      emailType:                  'information',
      urgency:                    'medium',
      mentionedResponsiblePersons: [],
      detectedProject:            null,
      detectedProjectConfidence:  0,
      participantDomains:         [extractDomain(params.fromEmail)],
      piiWasMasked:               masked.wasMasked,
      tokensUsed:                 0,
    }
  }
}

function extractDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at !== -1 ? email.slice(at + 1).toLowerCase() : email.toLowerCase()
}
