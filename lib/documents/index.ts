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
