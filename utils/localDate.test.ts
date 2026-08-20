import { describe, expect, it } from 'vitest'
import {
  addDaysLocal,
  clampToToday,
  formatDayLabel,
  isFutureLocal,
  parseLocalDate,
  periodStartLocal,
  todayLocal,
  tzOffsetMinutes,
} from './localDate'

describe('todayLocal', () => {
  it('reads the LOCAL calendar date, not the UTC one', () => {
    // The classic bug: toISOString().slice(0,10) on this instant returns
    // 2026-08-20 in UTC, but it is still the 19th for anyone west of Greenwich.
    // Constructing from local parts is what makes the two agree.
    const evening = new Date(2026, 7, 19, 22, 30)
    expect(todayLocal(evening)).toBe('2026-08-19')
  })

  it('zero-pads month and day', () => {
    expect(todayLocal(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('never emits a UTC-shifted date at either end of the day', () => {
    expect(todayLocal(new Date(2026, 7, 19, 0, 0))).toBe('2026-08-19')
    expect(todayLocal(new Date(2026, 7, 19, 23, 59))).toBe('2026-08-19')
  })
})

describe('tzOffsetMinutes', () => {
  it('is minutes EAST of UTC, the opposite sign to getTimezoneOffset', () => {
    // The server's lib/dates.ts expects this direction. Reversing it produces an
    // off-by-one-day rejection near midnight.
    const now = new Date()
    expect(tzOffsetMinutes(now)).toBe(-now.getTimezoneOffset())
  })
})

describe('parseLocalDate', () => {
  it('does not shift the day', () => {
    // new Date('2026-08-19') is UTC midnight and renders as the 18th in the
    // Americas; passing the parts separately keeps the calendar date intact.
    const parsed = parseLocalDate('2026-08-19')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(7)
    expect(parsed.getDate()).toBe(19)
  })

  it('round-trips through todayLocal', () => {
    expect(todayLocal(parseLocalDate('2026-02-29'.replace('29', '28')))).toBe('2026-02-28')
  })
})

describe('isFutureLocal', () => {
  const now = new Date(2026, 7, 19, 12, 0)

  it('rejects tomorrow and accepts today and the past', () => {
    expect(isFutureLocal('2026-08-20', now)).toBe(true)
    expect(isFutureLocal('2026-08-19', now)).toBe(false)
    expect(isFutureLocal('2026-08-18', now)).toBe(false)
  })

  it('compares correctly across a year boundary', () => {
    expect(isFutureLocal('2027-01-01', new Date(2026, 11, 31, 23, 0))).toBe(true)
    expect(isFutureLocal('2025-12-31', new Date(2026, 0, 1, 1, 0))).toBe(false)
  })
})

describe('addDaysLocal', () => {
  it('crosses months and years', () => {
    expect(addDaysLocal('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDaysLocal('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysLocal('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('handles a leap day', () => {
    expect(addDaysLocal('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('survives a DST transition without losing or repeating a day', () => {
    // Date arithmetic on local parts, so a clock change cannot shift the result.
    expect(addDaysLocal('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDaysLocal('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDaysLocal('2026-10-31', 1)).toBe('2026-11-01')
  })
})

describe('periodStartLocal', () => {
  it('is inclusive, so a 7-day period spans exactly 7 dates', () => {
    const now = new Date(2026, 7, 19)
    expect(periodStartLocal(7, now)).toBe('2026-08-13')
    expect(periodStartLocal(30, now)).toBe('2026-07-21')
    expect(periodStartLocal(90, now)).toBe('2026-05-22')
  })
})

describe('clampToToday', () => {
  it('pulls a future date back to today and leaves the past alone', () => {
    const now = new Date(2026, 7, 19)
    expect(clampToToday('2026-09-01', now)).toBe('2026-08-19')
    expect(clampToToday('2026-08-01', now)).toBe('2026-08-01')
  })
})

describe('formatDayLabel', () => {
  const now = new Date(2026, 7, 19, 12, 0)

  it('names today and yesterday', () => {
    expect(formatDayLabel('2026-08-19', now)).toBe('Hoy')
    expect(formatDayLabel('2026-08-18', now)).toBe('Ayer')
  })

  it('falls back to a readable date', () => {
    expect(formatDayLabel('2026-08-10', now)).not.toMatch(/Hoy|Ayer/)
    expect(formatDayLabel('2026-08-10', now).length).toBeGreaterThan(0)
  })
})
