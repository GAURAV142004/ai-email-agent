import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

// Amazon Titan Embed Text v2 — 1024 dimensions, free tier available
const EMBED_MODEL = 'amazon.titan-embed-text-v2:0'

/**
 * Generate a 1024-dimension vector embedding for a text string.
 * Used to store KB entries for semantic similarity search.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Titan Embed v2 max input is 8192 tokens (~32k chars); truncate to be safe
  const truncated = text.slice(0, 8000)

  const body = JSON.stringify({
    inputText: truncated,
    dimensions: 1024,
    normalize: true,
  })

  const command = new InvokeModelCommand({
    modelId:     EMBED_MODEL,
    contentType: 'application/json',
    accept:      'application/json',
    body:        Buffer.from(body),
  })

  const response = await bedrock.send(command)
  const result   = JSON.parse(Buffer.from(response.body).toString('utf-8'))

  if (!Array.isArray(result.embedding)) {
    throw new Error('Titan Embed: unexpected response format')
  }

  return result.embedding as number[]
}

/**
 * Format a KB entry's text for embedding.
 * Concatenates summary + key points — rich enough for semantic search
 * without including raw email content.
 */
export function buildEmbeddingText(params: {
  summary: string
  keyPoints: string[]
  detectedProject: string | null
  subject: string
}): string {
  const parts = [
    params.detectedProject ? `Project: ${params.detectedProject}` : null,
    `Subject: ${params.subject}`,
    `Summary: ${params.summary}`,
    params.keyPoints.length > 0
      ? `Key points: ${params.keyPoints.join('. ')}`
      : null,
  ]
  return parts.filter(Boolean).join('\n')
}

/** Format embedding array for pgvector insert: "[0.1,0.2,...]" */
export function formatVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
