import { describe, expect, it } from 'vitest'
import { csvField, toCsv } from './csv'

describe('csvField', () => {
  it('leaves ordinary text alone', () => {
    expect(csvField('Grilled chicken')).toBe('Grilled chicken')
  })

  it('quotes and doubles embedded quotes', () => {
    expect(csvField('He said "hello"')).toBe('"He said ""hello"""')
  })

  it('quotes fields containing commas or newlines', () => {
    expect(csvField('rice, beans')).toBe('"rice, beans"')
    expect(csvField('line one\nline two')).toBe('"line one\nline two"')
  })

  it('renders booleans and numbers plainly', () => {
    expect(csvField(true)).toBe('true')
    expect(csvField(-3)).toBe('-3')
  })

  it('defuses formula injection', () => {
    // A description is free text. Excel, Sheets and Numbers all interpret a
    // leading =, +, - or @ as a FORMULA, so an exported dish name could execute
    // in the user's own spreadsheet. The leading quote makes it inert text.
    expect(csvField('=1+1')).toBe("'=1+1")
    expect(csvField('+SUM(A1)')).toBe("'+SUM(A1)")
    expect(csvField('@import')).toBe("'@import")
    // A pipe is not an RFC 4180 quoting trigger, so this needs the guard only.
    expect(csvField('=cmd|/c calc')).toBe("'=cmd|/c calc")
  })

  it('still quotes a defused field that also contains a comma', () => {
    expect(csvField('=A1,B2')).toBe('"\'=A1,B2"')
  })

  it('does not mangle a negative score', () => {
    // The guard fires only on strings. A spreadsheet reading -3 as a number is
    // correct, and defusing it would turn the score column into text.
    expect(csvField(-3)).toBe('-3')
    // The same characters typed into a DESCRIPTION are still defused.
    expect(csvField('-1+1')).toBe("'-1+1")
  })
})

describe('toCsv', () => {
  it('writes a header and CRLF line endings, per RFC 4180', () => {
    const csv = toCsv(['date', 'score'], [['2026-08-19', 3]])
    expect(csv).toBe('date,score\r\n2026-08-19,3\r\n')
  })

  it('handles an empty export', () => {
    expect(toCsv(['date', 'score'], [])).toBe('date,score\r\n')
  })
})
