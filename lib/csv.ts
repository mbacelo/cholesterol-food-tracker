/**
 * CSV serialization for the export (functional spec §6.8).
 *
 * PURE, so the quoting rules are unit-testable without a request.
 */

/**
 * Quotes one field per RFC 4180, and defuses formula injection.
 *
 * The second part matters more than it looks: a description is free text, and a
 * value starting with = + - or @ is interpreted as a FORMULA by Excel, Sheets and
 * Numbers when the file is opened. A dish called "=cmd|..." would become an
 * executable cell in the user's own spreadsheet. Prefixing a single quote makes
 * it inert text while still displaying the original characters.
 */
export function csvField(value: string | number | boolean): string {
  let text = String(value)
  // Only STRINGS are defused. A number is not a formula risk, and prefixing a
  // score of -3 would turn a numeric column into text in the user's spreadsheet.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

export function csvRow(values: (string | number | boolean)[]): string {
  return values.map(csvField).join(',')
}

/** Serializes rows with a header. CRLF line endings, as RFC 4180 specifies. */
export function toCsv(header: string[], rows: (string | number | boolean)[][]): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n'
}
