/**
 * Every derived figure in the app comes from this module (tech spec §2).
 *
 * Nothing else may compute an average. That rule is what makes functional spec
 * §7's business rules testable without a network call, and it is why the two
 * easiest bugs in this app are structurally impossible here:
 *
 *   - A date with no entries is NOT a zero (rule 8). It has no summary object at
 *     all, and `trendSeries` represents it as `average: null` so a chart draws a
 *     gap rather than a dip to the axis.
 *   - A day with fewer than `minEntriesForValidDay` entries is `incomplete`
 *     (rule 9). It is excluded from goal pass/fail, but its entries still count
 *     in the score distribution.
 *
 * PURE: no I/O, no clock, no network, no environment access. "Today" is never
 * decided here -- callers pass the dates they care about.
 */

/** A stored entry, reduced to the two fields aggregation needs. */
export interface ScoredEntry {
  /** Plain local date, YYYY-MM-DD. Never a timestamp. */
  entryDate: string
  score: number
}

/** A single date's rollup, as already aggregated by SQL or by `summarizeDays`. */
export interface DayTotals {
  date: string
  count: number
  /** Arithmetic mean of that date's entry scores. */
  average: number
}

export type DayStatus = 'pass' | 'miss' | 'incomplete'

export interface DaySummary extends DayTotals {
  status: DayStatus
}

export interface GoalSettings {
  /** functional spec §3.3 `daily_average_target`. */
  target: number
  /** functional spec §3.3 `min_entries_for_valid_day`. */
  minEntriesForValidDay: number
}

/** One point of the score-over-time chart. `average: null` means "not logged". */
export interface TrendPoint {
  date: string
  average: number | null
  count: number
}

export interface DistributionBucket {
  score: number
  count: number
}

export interface PeriodStats {
  /**
   * Mean of the COMPLETE days' daily averages, or null when the period has no
   * complete day.
   *
   * Averaging day-averages rather than pooling all entries is deliberate: the
   * goal is expressed as a daily average, so the period figure has to be in the
   * same unit to be comparable to it. Pooling entries would silently weight a
   * six-entry day six times more heavily than a two-entry day.
   */
  average: number | null
  /** Complete days whose average met the target. */
  daysOnTarget: number
  /** Days with at least `minEntriesForValidDay` entries. The pass/fail denominator. */
  completeDays: number
  /** Days with at least one entry but fewer than the minimum. */
  incompleteDays: number
  /** Days with at least one entry. completeDays + incompleteDays. */
  loggedDays: number
  /** True when the period average meets the target. False when it does not, null when unknown. */
  meetsTarget: boolean | null
}

export const MIN_SCORE = -5
export const MAX_SCORE = 5

/** Arithmetic mean, or null for no entries. Null is never rendered as zero. */
export function dailyAverage(scores: readonly number[]): number | null {
  if (scores.length === 0) return null
  let total = 0
  for (const score of scores) total += score
  return total / scores.length
}

/**
 * Classifies one date.
 *
 * A day below the entry minimum is `incomplete` rather than pass or fail, so a
 * single logged snack cannot distort the record (functional spec §3.3).
 */
export function dayStatus(count: number, average: number, settings: GoalSettings): DayStatus {
  if (count < settings.minEntriesForValidDay) return 'incomplete'
  return average >= settings.target ? 'pass' : 'miss'
}

/**
 * Groups entries by date and classifies each date.
 *
 * Only dates that actually have entries appear in the result -- there is no
 * placeholder for an unlogged day, which is what makes rule 8 unrepresentable.
 * Sorted ascending by date.
 */
export function summarizeDays(
  entries: readonly ScoredEntry[],
  settings: GoalSettings,
): DaySummary[] {
  const byDate = new Map<string, number[]>()
  for (const entry of entries) {
    const bucket = byDate.get(entry.entryDate)
    if (bucket) bucket.push(entry.score)
    else byDate.set(entry.entryDate, [entry.score])
  }

  const summaries: DaySummary[] = []
  for (const [date, scores] of byDate) {
    const average = dailyAverage(scores)
    if (average === null) continue
    summaries.push({
      date,
      count: scores.length,
      average,
      status: dayStatus(scores.length, average, settings),
    })
  }
  return summaries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Classifies pre-aggregated SQL rollups without re-deriving the averages. */
export function classifyDays(
  totals: readonly DayTotals[],
  settings: GoalSettings,
): DaySummary[] {
  return totals
    .map((day) => ({ ...day, status: dayStatus(day.count, day.average, settings) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * Period rollup, answering the dashboard's first question: am I meeting my goal?
 *
 * Incomplete days are excluded from both the average and the pass/fail count
 * (rule 9), so the denominator reported to the user is complete days. The UI
 * must word it that way -- "18 of 26 complete days" -- rather than implying that
 * every logged day was eligible.
 */
export function periodStats(days: readonly DaySummary[], settings: GoalSettings): PeriodStats {
  const complete = days.filter((day) => day.status !== 'incomplete')
  const incompleteDays = days.length - complete.length
  const average = dailyAverage(complete.map((day) => day.average))

  return {
    average,
    daysOnTarget: complete.filter((day) => day.average >= settings.target).length,
    completeDays: complete.length,
    incompleteDays,
    loggedDays: days.length,
    meetsTarget: average === null ? null : average >= settings.target,
  }
}

/**
 * Expands day rollups into one point per date across an inclusive range, with
 * `average: null` on dates that were never logged.
 *
 * The nulls are the point: a line chart must draw a gap there. Substituting 0
 * would read as "I ate badly that day" when the truth is "I logged nothing".
 * Both bounds are plain local dates, YYYY-MM-DD.
 */
export function trendSeries(
  days: readonly DayTotals[],
  from: string,
  to: string,
): TrendPoint[] {
  const byDate = new Map(days.map((day) => [day.date, day]))
  const points: TrendPoint[] = []
  for (const date of eachDate(from, to)) {
    const day = byDate.get(date)
    points.push({
      date,
      average: day ? day.average : null,
      count: day ? day.count : 0,
    })
  }
  return points
}

/**
 * Counts entries at each score from -5 to +5.
 *
 * Always returns all eleven buckets, including empty ones, so the chart axis
 * reads -5..+5 even on sparse data. Entries from incomplete days ARE counted
 * here: rule 9 excludes those days from goal pass/fail, not from the
 * distribution.
 */
export function distribution(scores: readonly number[]): DistributionBucket[] {
  const counts = new Map<number, number>()
  for (let score = MIN_SCORE; score <= MAX_SCORE; score += 1) counts.set(score, 0)
  for (const score of scores) {
    const rounded = Math.round(score)
    if (rounded < MIN_SCORE || rounded > MAX_SCORE) continue
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1)
  }
  return [...counts.entries()].map(([score, count]) => ({ score, count }))
}

/** Merges pre-aggregated SQL score counts into the full eleven-bucket shape. */
export function fillDistribution(
  rows: readonly DistributionBucket[],
): DistributionBucket[] {
  const byScore = new Map(rows.map((row) => [row.score, row.count]))
  const buckets: DistributionBucket[] = []
  for (let score = MIN_SCORE; score <= MAX_SCORE; score += 1) {
    buckets.push({ score, count: byScore.get(score) ?? 0 })
  }
  return buckets
}

/**
 * Every date from `from` to `to` inclusive, as YYYY-MM-DD.
 *
 * Steps through UTC midnight deliberately: these are plain calendar dates with
 * no timezone, and using UTC means a DST transition in the user's zone cannot
 * duplicate or skip a day. Returns nothing when the range is inverted.
 */
export function eachDate(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return []

  const dates: string[] = []
  const DAY_MS = 86_400_000
  for (let time = start; time <= end; time += DAY_MS) {
    dates.push(new Date(time).toISOString().slice(0, 10))
  }
  return dates
}
