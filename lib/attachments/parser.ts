import * as XLSX from 'xlsx'

// Cap extracted text at 4000 chars before passing to AI
const MAX_TEXT = 4000

export interface ParseResult {
  text:      string
  truncated: boolean
  pageCount?: number
}

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.xlsx', '.xls', '.docx', '.doc', '.csv', '.txt',
])

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/csv',
  'text/plain',
])

export function isSupportedAttachment(mimeType: string, filename: string): boolean {
  if (SUPPORTED_MIME_TYPES.has(mimeType)) return true
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  return SUPPORTED_EXTENSIONS.has(ext)
}

/**
 * Extracts plain text from an attachment buffer.
 * Returns empty text for unsupported or unreadable files.
 */
export async function extractText(
  buffer:   Buffer,
  mimeType: string,
  filename: string,
): Promise<ParseResult> {
  try {
    const lower = filename.toLowerCase()

    if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
      return await parsePDF(buffer)
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel' ||
      lower.endsWith('.xlsx') || lower.endsWith('.xls')
    ) {
      return parseExcel(buffer)
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword' ||
      lower.endsWith('.docx') || lower.endsWith('.doc')
    ) {
      return await parseDocx(buffer)
    }

    if (mimeType === 'text/csv' || lower.endsWith('.csv')) {
      return parseText(buffer)
    }

    if (mimeType.startsWith('text/') || lower.endsWith('.txt')) {
      return parseText(buffer)
    }

    return { text: '', truncated: false }
  } catch {
    return { text: '', truncated: false }
  }
}

async function parsePDF(buffer: Buffer): Promise<ParseResult> {
  // pdf-parse is declared as serverExternalPackages — Node.js resolves it natively,
  // Turbopack never bundles it, so require() works safely here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (
    buf: Buffer,
  ) => Promise<{ text: string; numpages: number }>

  const result = await pdfParse(buffer)
  const text   = result.text.replace(/\s+/g, ' ').trim()

  return {
    text:      text.slice(0, MAX_TEXT),
    truncated: text.length > MAX_TEXT,
    pageCount: result.numpages,
  }
}

function parseExcel(buffer: Buffer): ParseResult {
  const wb    = XLSX.read(buffer, { type: 'buffer' })
  const parts: string[] = []

  for (const sheetName of wb.SheetNames) {
    const ws  = wb.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false })
    if (csv.trim()) parts.push(`[Sheet: ${sheetName}]\n${csv}`)
  }

  const text = parts.join('\n\n')
  return {
    text:      text.slice(0, MAX_TEXT),
    truncated: text.length > MAX_TEXT,
  }
}

async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const mammoth = await import('mammoth')
  const result  = await mammoth.extractRawText({ buffer })
  const text    = result.value.replace(/\s+/g, ' ').trim()

  return {
    text:      text.slice(0, MAX_TEXT),
    truncated: text.length > MAX_TEXT,
  }
}

function parseText(buffer: Buffer): ParseResult {
  const text = buffer.toString('utf-8').replace(/\s+/g, ' ').trim()
  return {
    text:      text.slice(0, MAX_TEXT),
    truncated: text.length > MAX_TEXT,
  }
}
