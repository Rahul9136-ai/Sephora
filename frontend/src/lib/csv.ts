export function downloadCSV<T extends object>(filename: string, rows: T[]) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0]) as (keyof T)[]
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => String(row[h])).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
