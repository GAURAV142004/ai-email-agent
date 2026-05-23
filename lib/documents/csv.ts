/**
 * Generates a CSV buffer from headers + rows.
 * Values are escaped per RFC 4180.
 */
export function generateCSV(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): Buffer {
  const escape = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const lines = [
    headers.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(',')),
  ]

  return Buffer.from(lines.join('\r\n'), 'utf-8')
}

export const CSV_MIME = 'text/csv'
