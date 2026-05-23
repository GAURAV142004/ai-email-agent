import * as XLSX from 'xlsx'

export interface ExcelSheetData {
  sheetName: string
  headers: string[]
  rows: (string | number | null | undefined)[][]
}

/**
 * Generates an Excel (.xlsx) workbook buffer from one or more sheets.
 */
export function generateExcel(sheets: ExcelSheetData[]): Buffer {
  const wb = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const wsData = [sheet.headers, ...sheet.rows]
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Auto-width columns
    const colWidths = sheet.headers.map((h, i) => {
      const maxLen = Math.max(
        h.length,
        ...sheet.rows.map(r => String(r[i] ?? '').length),
      )
      return { wch: Math.min(maxLen + 2, 60) }
    })
    ws['!cols'] = colWidths

    // Bold header row
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r: 0, c })
      if (ws[cellAddr]) {
        ws[cellAddr].s = { font: { bold: true } }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName.slice(0, 31))
  }

  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
  return Buffer.from(arrayBuffer)
}

export const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
