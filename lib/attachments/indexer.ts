import { SupabaseClient }                         from '@supabase/supabase-js'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { AttachmentMeta }                           from '@/lib/gmail/thread'
import { downloadAttachment }                       from './fetcher'
import { extractText, isSupportedAttachment }       from './parser'
import { maskPII }                                  from '@/lib/pii/masker'
import { generateEmbedding, formatVectorLiteral }   from '@/lib/kb/embeddings'

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0'

// Skip attachments larger than 10 MB
const MAX_SIZE_BYTES = 10 * 1024 * 1024

export interface AttachmentIndexResult {
  indexed: number
  skipped: number
  errors:  string[]
}

/**
 * Downloads, parses, summarizes, and stores all supported attachments
 * from a single email into email_attachments_kb.
 * Linked to the parent email KB entry via kb_entry_id.
 */
export async function indexAttachments(
  supabase:      SupabaseClient,
  kbEntryId:     string,
  memberId:      string,
  gmailThreadId: string,
  emailDate:     string,
  attachments:   AttachmentMeta[],
  accessToken:   string,
  refreshToken?: string,
): Promise<AttachmentIndexResult> {
  let indexed = 0
  let skipped = 0
  const errors: string[] = []

  for (const att of attachments) {
    try {
      // Skip unsupported file types and oversized files
      if (!isSupportedAttachment(att.mimeType, att.filename)) { skipped++; continue }
      if (att.sizeBytes > MAX_SIZE_BYTES)                      { skipped++; continue }

      // Skip if already indexed (deduplication)
      const { data: existing } = await supabase
        .from('email_attachments_kb')
        .select('id')
        .eq('owner_member_id', memberId)
        .eq('gmail_message_id', att.messageId)
        .eq('filename', att.filename)
        .maybeSingle()

      if (existing) { skipped++; continue }

      // Download raw bytes from Gmail
      const buffer = await downloadAttachment(
        att.messageId, att.attachmentId, accessToken, refreshToken,
      )

      // Extract readable text from file
      const parsed = await extractText(buffer, att.mimeType, att.filename)
      if (!parsed.text.trim()) { skipped++; continue }

      // Mask PII before sending to AI
      const masked = maskPII(parsed.text)

      // Summarize document content with AI
      const summary = await summarizeAttachment(att.filename, masked.masked)

      // Build embedding text and generate vector
      const embeddingText = [
        `File: ${att.filename}`,
        `Summary: ${summary.summary}`,
        summary.keyPoints.length > 0
          ? `Key points: ${summary.keyPoints.join('. ')}`
          : null,
      ].filter(Boolean).join('\n')

      const embedding = await generateEmbedding(embeddingText)

      await supabase.from('email_attachments_kb').insert({
        kb_entry_id:      kbEntryId,
        owner_member_id:  memberId,
        gmail_message_id: att.messageId,
        gmail_thread_id:  gmailThreadId,
        filename:         att.filename,
        mime_type:        att.mimeType,
        file_size_bytes:  att.sizeBytes,
        extracted_text:   masked.masked.slice(0, 3000),
        summary:          summary.summary,
        key_points:       summary.keyPoints,
        embedding:        formatVectorLiteral(embedding),
        email_date:       emailDate,
        pii_was_masked:   masked.wasMasked,
        tokens_used:      summary.tokensUsed,
      })

      indexed++
    } catch (err: any) {
      errors.push(`${att.filename}: ${err?.message ?? 'unknown error'}`)
      skipped++
    }
  }

  return { indexed, skipped, errors }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface AttachmentSummary {
  summary:    string
  keyPoints:  string[]
  tokensUsed: number
}

async function summarizeAttachment(
  filename: string,
  text:     string,
): Promise<AttachmentSummary> {
  const prompt = `Summarize this document for a project knowledge base.

Filename: "${filename}"
Content:
${text.slice(0, 3000)}

Rules:
- Focus on work/project-related content only
- Be factual and specific — mention version numbers, dates, amounts if present
- Extract concrete decisions, action items, or key data points

Respond with JSON:
{
  "summary": "2-3 sentence overview of what this document contains",
  "key_points": ["specific point 1", "specific point 2", "specific point 3"]
}`

  try {
    const body = JSON.stringify({
      messages:        [{ role: 'user', content: [{ text: prompt }] }],
      system:          [{ text: 'You are a document summarizer for a software delivery team. Respond with valid JSON only. No markdown.' }],
      inferenceConfig: { maxTokens: 400, temperature: 0.1 },
    })

    const resp   = await bedrock.send(new InvokeModelCommand({
      modelId:     MODEL_ID,
      contentType: 'application/json',
      accept:      'application/json',
      body:        Buffer.from(body),
    }))
    const result  = JSON.parse(Buffer.from(resp.body).toString('utf-8'))
    const tokens  = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0)
    const rawText = result.output?.message?.content?.[0]?.text ?? ''
    const parsed  = JSON.parse(rawText.replace(/```json|```/g, '').trim())

    return {
      summary:    parsed.summary    ?? filename,
      keyPoints:  Array.isArray(parsed.key_points) ? parsed.key_points : [],
      tokensUsed: tokens,
    }
  } catch {
    return { summary: filename, keyPoints: [], tokensUsed: 0 }
  }
}
