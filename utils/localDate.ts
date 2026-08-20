/**
 * The single source of "today" on the client (tech spec §8).
 *
 * Nothing else in the browser formats or compares a date. "Today" is today where
 * the USER is, so every outbound date comes from here along with the timezone
 * offset the server needs to check it.
 */

/**
 * Local calendar date as YYYY-MM-DD.
 *
 * Uses getFullYear/getMonth/getDate deliberately. `toISOString().slice(0,10)` is
 * the single most common bug in this area: it returns the UTC date, so anyone
 * west of Greenwich gets YESTERDAY for most of their evening.
 */
export function todayLocal(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Minutes EAST of UTC. Montevideo (UTC-3) gives -180.
 *
 * Negated, because the JavaScript built-in uses the opposite sign convention to
 * ISO-8601. lib/dates.ts on the server expects this direction; getting it
 * backwards produces an off-by-one-day rejection near midnight.
 */
export function tzOffsetMinutes(now: Date = new Date()): number {
  return -now.getTimezoneOffset()
}

/**
 * Parses YYYY-MM-DD as a LOCAL date.
 *
 * `new Date('2026-08-19')` is parsed as UTC midnight and renders as the previous
 * day west of Greenwich, so the parts are passed separately.
 */
export function parseLocalDate(ymd: string): Date {
  const [year, month, day] = ymd.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

/** Lexicographic comparison, exact for zero-padded ISO dates. */
export function isFutureLocal(ymd: string, now: Date = new Date()): boolean {
  return ymd > todayLocal(now)
}

export function clampToToday(ymd: string, now: Date = new Date()): string {
  const today = todayLocal(now)
  return ymd > today ? today : ymd
}

export function addDaysLocal(ymd: string, days: number): string {
  const date = parseLocalDate(ymd)
  date.setDate(date.getDate() + days)
  return todayLocal(date)
}

/** Inclusive start of a period ending today. */
export function periodStartLocal(days: 7 | 30 | 90, now: Date = new Date()): string {
  return addDaysLocal(todayLocal(now), -(days - 1))
}

export const MIN_ENTRY_DATE = '2020-01-01'

/** "Today", "Yesterday", or a short readable date. */
export function formatDayLabel(ymd: string, now: Date = new Date()): string {
  const today = todayLocal(now)
  if (ymd === today) return 'Today'
  if (ymd === addDaysLocal(today, -1)) return 'Yesterday'
  const date = parseLocalDate(ymd)
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function formatFullDate(ymd: string): string {
  return parseLocalDate(ymd).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
