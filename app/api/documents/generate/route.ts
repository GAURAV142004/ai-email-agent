import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { VISIBILITY_MAP } from '@/lib/roles'
import {
  generateCSV,
  generateExcel,
  generatePDF,
  getMimeType,
  getFileExtension,
  type DocumentFormat,
  type ExcelSheetData,
} from '@/lib/documents/index'
import type { PDFDocumentOptions, PDFTableSection } from '@/lib/documents/pdf'
import type { EmailKnowledgeBase, KBActionItem } from '@/lib/supabase/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type ReportType = 'action_items' | 'project_summary' | 'team_activity' | 'custom'

interface GenerateRequestBody {
  format:      DocumentFormat
  reportType:  ReportType
  title:       string
  filters?: {
    projectCluster?: string
    memberIds?:      string[]
    dateFrom?:       string
    dateTo?:         string
  }
  customData?: {
    headers: string[]
    rows:    unknown[][]
  }
}

const VALID_FORMATS: DocumentFormat[]  = ['csv', 'xlsx', 'pdf']
const VALID_REPORT_TYPES: ReportType[] = ['action_items', 'project_summary', 'team_activity', 'custom']

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeRow(row: unknown[]): (string | number | null | undefined)[] {
  return row.map(cell =>
    cell === null || cell === undefined || typeof cell === 'string' || typeof cell === 'number'
      ? (cell as string | number | null | undefined)
      : String(cell),
  )
}

// ── KB query: respects VISIBILITY_MAP ────────────────────────────────────────

async function queryKBEntries(
  supabase: ReturnType<typeof getServiceSupabase>,
  memberId:       string,
  memberRole:     string,
  filters:        GenerateRequestBody['filters'],
): Promise<{ entries: EmailKnowledgeBase[]; memberNames: Map<string, string> }> {
  const visibleRoles = VISIBILITY_MAP[memberRole as keyof typeof VISIBILITY_MAP] ?? [memberRole]

  // Resolve visible member IDs
  let memberQuery = supabase
    .from('team_members')
    .select('id, name, role')
    .in('role', visibleRoles)
    .eq('is_active', true)

  if (filters?.memberIds?.length) {
    memberQuery = memberQuery.in('id', filters.memberIds)
  }

  const { data: visibleMembers } = await memberQuery
  if (!visibleMembers || visibleMembers.length === 0) {
    return { entries: [], memberNames: new Map() }
  }

  const visibleMemberIds = visibleMembers.map(m => m.id)
  const memberNames      = new Map(visibleMembers.map(m => [m.id, m.name as string]))

  let kbQuery = supabase
    .from('email_knowledge_base')
    .select('*')
    .in('owner_member_id', visibleMemberIds)
    .order('email_date', { ascending: false })

  if (filters?.projectCluster) {
    kbQuery = kbQuery.eq('project_cluster_id', filters.projectCluster)
  }
  if (filters?.dateFrom) {
    kbQuery = kbQuery.gte('email_date', filters.dateFrom)
  }
  if (filters?.dateTo) {
    kbQuery = kbQuery.lte('email_date', filters.dateTo)
  }

  const { data: entries, error } = await kbQuery

  if (error) throw new Error(error.message)

  return { entries: entries ?? [], memberNames }
}

// ── Row builders per report type ──────────────────────────────────────────────

function buildActionItemsData(
  entries:     EmailKnowledgeBase[],
  memberNames: Map<string, string>,
): { headers: string[]; rows: (string | number | null | undefined)[][] } {
  const headers = ['Date', 'Member', 'Project', 'Task', 'Owner Hint', 'Due Date Hint', 'Source']
  const rows: (string | number | null | undefined)[][] = []

  for (const entry of entries) {
    const memberName = memberNames.get(entry.owner_member_id) ?? 'Unknown'
    const items      = (entry.action_items ?? []) as KBActionItem[]

    if (items.length === 0) {
      rows.push([
        entry.email_date ?? '',
        memberName,
        entry.detected_project ?? '',
        '',
        '',
        '',
        entry.classification_source ?? '',
      ])
    } else {
      for (const item of items) {
        rows.push([
          entry.email_date ?? '',
          memberName,
          entry.detected_project ?? '',
          item.task,
          item.owner_hint ?? '',
          item.due_date_hint ?? '',
          entry.classification_source ?? '',
        ])
      }
    }
  }

  return { headers, rows }
}

function buildProjectSummaryData(
  entries:     EmailKnowledgeBase[],
  memberNames: Map<string, string>,
): { headers: string[]; rows: (string | number | null | undefined)[][] } {
  const headers = ['Date', 'Member', 'Project', 'Summary', 'Key Points', 'Action Items Count', 'Classification']
  const rows    = entries.map(entry => [
    entry.email_date ?? '',
    memberNames.get(entry.owner_member_id) ?? 'Unknown',
    entry.detected_project ?? '',
    entry.summary,
    (entry.key_points ?? []).join('; '),
    (entry.action_items ?? []).length,
    entry.classification_source ?? '',
  ] as (string | number | null | undefined)[])

  return { headers, rows }
}

function buildTeamActivityData(
  entries:     EmailKnowledgeBase[],
  memberNames: Map<string, string>,
): { headers: string[]; rows: (string | number | null | undefined)[][] } {
  const headers = ['Date', 'Member', 'Project', 'Direction', 'Domains', 'PII Masked', 'Tokens Used']
  const rows    = entries.map(entry => [
    entry.email_date ?? '',
    memberNames.get(entry.owner_member_id) ?? 'Unknown',
    entry.detected_project ?? '',
    entry.direction ?? '',
    (entry.participant_domains ?? []).join(', '),
    entry.pii_was_masked ? 'Yes' : 'No',
    entry.tokens_used ?? 0,
  ] as (string | number | null | undefined)[])

  return { headers, rows }
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!member.consent_given) {
    return NextResponse.json(
      { error: 'Consent required before generating reports' },
      { status: 403 },
    )
  }

  let body: GenerateRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { format, reportType, title, filters, customData } = body

  // ── Validate inputs ─────────────────────────────────────────────────────
  if (!VALID_FORMATS.includes(format)) {
    return NextResponse.json(
      { error: `Invalid format. Must be one of: ${VALID_FORMATS.join(', ')}` },
      { status: 400 },
    )
  }
  if (!VALID_REPORT_TYPES.includes(reportType)) {
    return NextResponse.json(
      { error: `Invalid reportType. Must be one of: ${VALID_REPORT_TYPES.join(', ')}` },
      { status: 400 },
    )
  }
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (reportType === 'custom') {
    if (!customData || !Array.isArray(customData.headers) || !Array.isArray(customData.rows)) {
      return NextResponse.json(
        { error: 'customData.headers and customData.rows are required for reportType "custom"' },
        { status: 400 },
      )
    }
  }

  // ── Fetch KB data ────────────────────────────────────────────────────────
  let headers: string[]
  let rows:    (string | number | null | undefined)[][]

  if (reportType === 'custom') {
    headers = customData!.headers
    rows    = customData!.rows.map(sanitizeRow)
  } else {
    const supabase = getServiceSupabase()
    let entries: EmailKnowledgeBase[]
    let memberNames: Map<string, string>

    try {
      ;({ entries, memberNames } = await queryKBEntries(supabase, member.id, member.role, filters))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to query knowledge base'
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    switch (reportType) {
      case 'action_items':
        ;({ headers, rows } = buildActionItemsData(entries, memberNames))
        break
      case 'project_summary':
        ;({ headers, rows } = buildProjectSummaryData(entries, memberNames))
        break
      case 'team_activity':
        ;({ headers, rows } = buildTeamActivityData(entries, memberNames))
        break
      default:
        return NextResponse.json({ error: 'Unknown reportType' }, { status: 400 })
    }
  }

  // ── Generate document ────────────────────────────────────────────────────
  const cleanTitle   = title.trim()
  const timestamp    = new Date().toISOString().slice(0, 10)
  const safeTitle    = cleanTitle.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase()
  const filename     = `${safeTitle}_${timestamp}.${getFileExtension(format)}`
  const contentType  = getMimeType(format)

  let fileBuffer: Buffer

  try {
    if (format === 'csv') {
      fileBuffer = generateCSV(headers, rows)

    } else if (format === 'xlsx') {
      const sheetData: ExcelSheetData = {
        sheetName: cleanTitle.slice(0, 31),
        headers,
        rows,
      }
      fileBuffer = generateExcel([sheetData])

    } else {
      // pdf
      const section: PDFTableSection = { headers, rows }
      const pdfOptions: PDFDocumentOptions = {
        title:    cleanTitle,
        subtitle: filters?.dateFrom && filters?.dateTo
          ? `Period: ${filters.dateFrom} → ${filters.dateTo}`
          : undefined,
        sections:    [section],
        generatedBy: `${member.name} via AI Email Agent`,
      }
      fileBuffer = generatePDF(pdfOptions)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Document generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // ── Stream binary response ───────────────────────────────────────────────
  // Next.js 16 App Router expects BodyInit (Uint8Array / ArrayBuffer), not Buffer
  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(fileBuffer.length),
      'Cache-Control':       'no-store',
    },
  })
}
