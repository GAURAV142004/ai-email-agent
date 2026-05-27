export { generateCSV, CSV_MIME } from './csv'
export { generateExcel, EXCEL_MIME, type ExcelSheetData } from './excel'
export { generatePDF, PDF_MIME, type PDFDocumentOptions, type PDFTableSection } from './pdf'

export type DocumentFormat = 'csv' | 'xlsx' | 'pdf'

export function getMimeType(format: DocumentFormat): string {
  switch (format) {
    case 'csv':  return 'text/csv'
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'pdf':  return 'application/pdf'
  }
}

export function getFileExtension(format: DocumentFormat): string {
  return format
}

export function parseMarkdownTableOrList(text: string): { headers: string[]; rows: string[][] } {
  // Strip code blocks if they wrap the table (e.g. ```markdown)
  const cleanText = text.replace(/```[a-z]*\n/g, '').replace(/```/g, '').trim()
  const lines = cleanText.split('\n').map(line => line.trim())

  let tableStartIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('|') && lines[i].includes('---')) {
      tableStartIndex = i - 1
      break
    }
  }

  if (tableStartIndex !== -1 && tableStartIndex >= 0) {
    const headerLine = lines[tableStartIndex]
    const headers = headerLine.split('|').map(h => h.trim()).filter(h => h.length > 0)

    const rows: string[][] = []
    for (let i = tableStartIndex + 2; i < lines.length; i++) {
      const line = lines[i]
      if (!line.startsWith('|')) break
      const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
      if (cells.length > 0) {
        rows.push(cells)
      }
    }

    if (headers.length > 0 && rows.length > 0) {
      return { headers, rows }
    }
  }

  // Fallback: parse bullet points/numbered lists or paragraphs as rows in a single column
  const headers = ['Report Content']
  const rows: string[][] = []

  for (const line of lines) {
    if (line.length === 0 || line.startsWith('#')) continue
    const cleanLine = line.replace(/^[-•*+]\s+/, '').replace(/^\d+\.\s+/, '')
    rows.push([cleanLine])
  }

  return {
    headers,
    rows: rows.length > 0 ? rows : [['No content available in this report.']]
  }
}
