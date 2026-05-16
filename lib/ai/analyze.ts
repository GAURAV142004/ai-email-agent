import { GoogleGenerativeAI } from '@google/generative-ai'
import { buildEmailAnalysisPrompt, buildFollowUpDraftPrompt } from './prompts'
import { maskPII, type MaskResult } from '@/lib/pii/masker'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export interface EmailAnalysisResult {
  summary: string
  requires_action: boolean
  priority: 'high' | 'medium' | 'low'
  tasks: Array<{
    task: string
    priority: 'high' | 'medium' | 'low'
    due_date: string | null
    assigned_to: string | null
  }>
  _pii?: {
    detectedTypes: string[]
    itemsRemoved: number
    wasMasked: boolean
  }
}

export interface FollowUpDraft {
  subject: string
  body: string
}

async function callGeminiWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 2
): Promise<T> {
  const delays = [5000, 15000] // 5s then 15s
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const is429 = err?.status === 429 || err?.message?.includes('429')
      if (is429 && attempt < retries) {
        await new Promise(r => setTimeout(r, delays[attempt]))
        continue
      }
      throw err
    }
  }
  throw new Error('callGeminiWithBackoff: exhausted retries')
}

export async function analyzeEmailThread(
  threadContent: string,
  subject: string
): Promise<EmailAnalysisResult> {
  const maskResult: MaskResult = maskPII(threadContent)

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction:
      'You are an AI assistant specialized in analyzing email threads and extracting actionable tasks. Always respond with valid JSON only — no markdown, no explanation.',
  })

  const result = await callGeminiWithBackoff(() =>
    model.generateContent(buildEmailAnalysisPrompt(subject, maskResult.masked))
  )
  const text = result.response.text().trim()

  // Strip markdown code fences if present
  const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const parsed = JSON.parse(json) as EmailAnalysisResult

  return {
    summary: parsed.summary ?? '',
    requires_action: parsed.requires_action ?? false,
    priority: parsed.priority ?? 'medium',
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    _pii: {
      detectedTypes: maskResult.detectedTypes,
      itemsRemoved: maskResult.itemsRemoved,
      wasMasked: maskResult.wasMasked,
    },
  }
}

export async function generateFollowUpDraft(
  subject: string,
  threadContent: string,
  taskDescription: string
): Promise<FollowUpDraft> {
  const maskResult: MaskResult = maskPII(threadContent)

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

  const result = await callGeminiWithBackoff(() =>
    model.generateContent(
      buildFollowUpDraftPrompt(subject, maskResult.masked, taskDescription)
    )
  )
  const text = result.response.text().trim()
  const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

  return JSON.parse(json) as FollowUpDraft
}
