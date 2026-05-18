import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { maskPII } from '@/lib/pii/masker'
import {
  buildEmailAnalysisPrompt,
  buildFollowUpDraftPrompt,
} from './prompts'
import { cleanEmailForAI } from './pre-filter'

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

const MODEL_ID = process.env.BEDROCK_MODEL_ID
  ?? 'amazon.nova-lite-v1:0'

export interface EmailAnalysisResult {
  summary:        string
  requiresAction: boolean
  priority:       'high' | 'medium' | 'low'
  tasks: Array<{
    task:     string
    priority: 'high' | 'medium' | 'low'
    due_date: string | null
  }>
  tokensUsed:    number
  piiItemsFound: number
}

async function callBedrockWithBackoff<T>(
  fn:      () => Promise<T>,
  retries = 3,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: any) {
      const isThrottle =
        err?.name === 'ThrottlingException' ||
        err?.name === 'ServiceUnavailableException'
      if (isThrottle && i < retries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error('callBedrockWithBackoff: exhausted retries')
}

async function invokeNova(
  systemPrompt: string,
  userPrompt:   string,
  maxTokens:    number = 500,
  temperature:  number = 0.1,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {

  // Amazon Nova uses converse-style messages format
  const body = JSON.stringify({
    messages: [
      {
        role:    'user',
        content: [{ text: userPrompt }],
      },
    ],
    system: [{ text: systemPrompt }],
    inferenceConfig: {
      maxTokens,
      temperature,
    },
  })

  const command = new InvokeModelCommand({
    modelId:     MODEL_ID,
    contentType: 'application/json',
    accept:      'application/json',
    body:        Buffer.from(body),
  })

  const response = await bedrock.send(command)
  const result   = JSON.parse(
    Buffer.from(response.body).toString('utf-8')
  )

  return {
    text:         result.output?.message?.content?.[0]?.text ?? '',
    inputTokens:  result.usage?.inputTokens  ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  }
}

export async function analyzeEmailThread(
  threadContent: string,
  subject:       string,
): Promise<EmailAnalysisResult> {

  const cleaned    = cleanEmailForAI(threadContent)
  const maskResult = maskPII(cleaned)

  const systemPrompt =
    'You are an email analysis assistant. ' +
    'Always respond with valid JSON only. ' +
    'No markdown, no explanation, just raw JSON.'

  const userPrompt = buildEmailAnalysisPrompt(
    subject,
    maskResult.masked
  )

  const { text, inputTokens, outputTokens } =
    await callBedrockWithBackoff(() =>
      invokeNova(systemPrompt, userPrompt, 500, 0.1)
    )

  const tokensUsed  = inputTokens + outputTokens
  const cleanedText = text.replace(/```json|```/g, '').trim()

  let parsed: any = {}
  try {
    parsed = JSON.parse(cleanedText)
  } catch {
    return {
      summary:        subject || 'Email received',
      requiresAction: true,
      priority:       'medium',
      tasks:          [],
      tokensUsed,
      piiItemsFound:  maskResult.itemsRemoved,
    }
  }

  return {
    summary:        parsed.summary         ?? subject,
    requiresAction: parsed.requires_action ?? true,
    priority:       parsed.priority        ?? 'medium',
    tasks:          parsed.tasks           ?? [],
    tokensUsed,
    piiItemsFound:  maskResult.itemsRemoved,
  }
}

export async function generateFollowUpDraft(
  threadContent: string,
  subject:       string,
  instructions?: string,
): Promise<{ subject: string; body: string; tokensUsed: number }> {

  const cleaned    = cleanEmailForAI(threadContent)
  const maskResult = maskPII(cleaned)

  const systemPrompt =
    'You are a professional email writer. ' +
    'Always respond with valid JSON only. ' +
    'No markdown, no explanation.'

  const userPrompt = buildFollowUpDraftPrompt(
    subject,
    maskResult.masked,
    instructions
  )

  const { text, inputTokens, outputTokens } =
    await callBedrockWithBackoff(() =>
      invokeNova(systemPrompt, userPrompt, 800, 0.4)
    )

  const tokensUsed  = inputTokens + outputTokens
  const cleanedText = text.replace(/```json|```/g, '').trim()

  let parsed: any = {}
  try {
    parsed = JSON.parse(cleanedText)
  } catch {
    return {
      subject:   `Re: ${subject}`,
      body:      'Thank you for your email. I will get back to you shortly.',
      tokensUsed,
    }
  }

  return {
    subject:   parsed.subject ?? `Re: ${subject}`,
    body:      parsed.body    ?? '',
    tokensUsed,
  }
}

// Quick classifier using Nova Micro (cheapest)
// for fast automated/human classification
export async function quickClassifyEmail(
  subject:     string,
  bodySnippet: string,
): Promise<{ isAutomated: boolean; needsReply: boolean }> {
  try {
    const { text } = await invokeNova(
      'Reply with JSON only: {"automated": true|false, "needs_reply": true|false}',
      `Subject: "${subject}"\nSnippet: "${bodySnippet.slice(0, 200)}"`,
      50,
      0,
    )
    const cleaned = text.replace(/```json|```/g, '').trim()
    const parsed  = JSON.parse(cleaned)
    return {
      isAutomated: parsed.automated   === true,
      needsReply:  parsed.needs_reply === true,
    }
  } catch {
    return { isAutomated: false, needsReply: true }
  }
}
