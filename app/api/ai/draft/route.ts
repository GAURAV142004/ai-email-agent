import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit: 10 drafts per minute per member
  const rl = checkRateLimit(`draft:${member.id}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many draft requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { subject, fromName, snippet } = body as {
    subject?: string
    fromName?: string
    snippet?: string
  }

  if (!subject && !snippet) {
    return NextResponse.json({ error: 'subject or snippet is required' }, { status: 400 })
  }

  const senderLine = fromName ? `From: ${fromName}` : ''
  const subjectLine = subject ? `Subject: ${subject}` : ''
  const snippetLine = snippet ? `Original email content:\n${snippet}` : ''

  const prompt = [senderLine, subjectLine, snippetLine].filter(Boolean).join('\n')

  const systemPrompt = `You are a professional email assistant helping a software delivery team member write concise, professional reply emails.

Rules:
- Write ONLY the reply body — no greeting like "Dear [Name]" unless it fits naturally, no subject line, no signature
- Keep replies focused, professional, and concise (2–4 sentences unless more detail is genuinely needed)
- Match the tone of the original email (formal if formal, casual if casual)
- Do not make up facts — if you don't know something specific, write a placeholder like [your response here]
- Do not include meta-commentary or explain what you are doing`

  const userMessage = `Draft a professional reply to this email:\n\n${prompt}`

  try {
    const bedrockBody = JSON.stringify({
      messages: [{ role: 'user', content: [{ text: userMessage }] }],
      system:   [{ text: systemPrompt }],
      inferenceConfig: { maxTokens: 400, temperature: 0.4 },
    })

    const resp   = await bedrock.send(new InvokeModelCommand({
      modelId:     MODEL_ID,
      contentType: 'application/json',
      accept:      'application/json',
      body:        Buffer.from(bedrockBody),
    }))
    const parsed = JSON.parse(Buffer.from(resp.body).toString('utf-8'))
    const draft  = parsed.output?.message?.content?.[0]?.text?.trim() ?? ''

    if (!draft) return NextResponse.json({ error: 'AI returned empty draft' }, { status: 500 })

    return NextResponse.json({ draft })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to generate draft' }, { status: 500 })
  }
}
