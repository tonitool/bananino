const NEEDS_QUOTING = /[",\r\n]/

export const escapeCell = (value) => {
  const text = String(value ?? '')
  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export const toRow = (cells) => cells.map(escapeCell).join(',')

/** A small RFC 4180 reader: enough for files this app wrote itself, plus hand edits. */
export const parseCsv = (text) => {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (quoted) {
      if (char !== '"') cell += char
      else if (text[i + 1] === '"') (cell += '"'), (i += 1)
      else quoted = false
      continue
    }

    if (char === '"') quoted = true
    else if (char === ',') (row.push(cell), (cell = ''))
    else if (char === '\n') (row.push(cell), rows.push(row), (row = []), (cell = ''))
    else if (char !== '\r') cell += char
  }

  if (cell !== '' || row.length > 0) (row.push(cell), rows.push(row))
  return rows.filter((r) => r.some((c) => c !== ''))
}

/** Rows as objects keyed by the header row; unknown shapes are dropped, not guessed at. */
export const parseCsvRecords = (text, expectedHeader) => {
  const [header, ...rows] = parseCsv(text)
  if (!header || expectedHeader.some((key, i) => header[i] !== key)) return []
  return rows.map((cells) => Object.fromEntries(expectedHeader.map((k, i) => [k, cells[i] ?? ''])))
}
