/**
 * Server-side date handling.
 *
 * Dates in this app are the USER's local dates (tech spec §3). "Today" is today
 * where the user is, not where the server is -- a Vercel function in another
 * region must never decide which day an entry belongs to. So `entry_date` is a
 * plain date supplied by the client, and requests carry `tz_offset_minutes` so
 * the server can compute the caller's local date and reject anything later.
 *
 * SIGN CONVENTION: minutes EAST of UTC, matching how an ISO-8601 offset reads.
 * Montevideo (UTC-3) sends -180. The client produces this as
 * `-new Date().getTimezoneOffset()`, because the JavaScript built-in has the
 * opposite sign. Getting this backwards produces an off-by-one-day rejection
 * near midnight, which is exactly the timezone-skew risk in tech spec §10, so
 * the convention is asserted in both this module's tests and the client's.
 */

/** Widest real-world offsets: UTC-12 to UTC+14. */
export const MIN_TZ_OFFSET_MINUTES = -720
export const MAX_TZ_OFFSET_MINUTES = 840

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** The caller's local calendar date, as YYYY-MM-DD. */
export function localDayFromOffset(tzOffsetMinutes: number, now: number = Date.now()): string {
  const shifted = new Date(now + tzOffsetMinutes * 60_000)
  return shifted.toISOString().slice(0, 10)
}

/**
 * True when `date` is later than the caller's local today.
 *
 * A lexicographic comparison is safe and exact for zero-padded ISO dates, and
 * avoids constructing a Date from the string -- `new Date('2026-08-19')` parses
 * as UTC midnight, which renders as the previous day everywhere west of
 * Greenwich.
 */
export function isFutureLocalDate(
  date: string,
  tzOffsetMinutes: number,
  now: number = Date.now(),
): boolean {
  return date > localDayFromOffset(tzOffsetMinutes, now)
}

export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  // Rejects 2026-02-30 and friends: the round trip only survives a real date.
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Inclusive start of a period ending on the caller's local today. */
export function periodStart(days: number, tzOffsetMinutes: number, now: number = Date.now()): string {
  const today = localDayFromOffset(tzOffsetMinutes, now)
  const start = new Date(`${today}T00:00:00Z`).getTime() - (days - 1) * 86_400_000
  return new Date(start).toISOString().slice(0, 10)
}
