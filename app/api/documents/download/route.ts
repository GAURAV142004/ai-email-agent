import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import {
  generateCSV,
  generateExcel,
  generatePDF,
  getMimeType,
  parseMarkdownTableOrList,
  type DocumentFormat,
  type ExcelSheetData,
} from '@/lib/documents/index'
import type { PDFDocumentOptions, PDFTableSection } from '@/lib/documents/pdf'


export async function GET(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!member.consent_given) {
    return NextResponse.json(
      { error: 'Consent required before downloading documents' },
      { status: 403 },
    )
  }

  const { searchParams } = new URL(request.url)
  const filename = searchParams.get('filename')

  if (!filename) {
    return NextResponse.json({ error: 'filename is required' }, { status: 400 })
  }

  const extension = filename.split('.').pop()?.toLowerCase() as DocumentFormat | undefined
  if (!extension || !['csv', 'xlsx', 'pdf'].includes(extension)) {
    return NextResponse.json({ error: 'Invalid file format extension' }, { status: 400 })
  }

  const supabase = getServiceSupabase()
  const { data: message, error } = await supabase
    .from('agent_messages')
    .select('content')
    .eq('document_filename', filename)
    .maybeSingle()

  if (error || !message) {
    return NextResponse.json({ error: 'Message or document not found' }, { status: 404 })
  }

  const { headers, rows } = parseMarkdownTableOrList(message.content)
  const title = filename.replace(/\.[^/.]+$/, "").replace(/_/g, " ")

  let fileBuffer: Buffer

  try {
    if (extension === 'csv') {
      fileBuffer = generateCSV(headers, rows)
    } else if (extension === 'xlsx') {
      const sheetData: ExcelSheetData = {
        sheetName: title.slice(0, 31),
        headers,
        rows,
      }
      fileBuffer = generateExcel([sheetData])
    } else {
      // pdf
      const section: PDFTableSection = { headers, rows }
      const pdfOptions: PDFDocumentOptions = {
        title,
        sections: [section],
        generatedBy: `${member.name} via AI Email Agent`,
      }
      fileBuffer = generatePDF(pdfOptions)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Document generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const contentType = getMimeType(extension)

  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(fileBuffer.length),
      'Cache-Control': 'no-store',
    },
  })
}
