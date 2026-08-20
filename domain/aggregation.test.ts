import { describe, expect, it } from 'vitest'
import {
  classifyDays,
  dailyAverage,
  dayStatus,
  distribution,
  eachDate,
  fillDistribution,
  periodStats,
  summarizeDays,
  trendSeries,
  type GoalSettings,
  type ScoredEntry,
} from './aggregation'

/** The spec defaults: target +1.0, two entries for a valid day. */
const SETTINGS: GoalSettings = { target: 1, minEntriesForValidDay: 2 }

const entry = (entryDate: string, score: number): ScoredEntry => ({ entryDate, score })

describe('dailyAverage', () => {
  it('is the arithmetic mean of that date’s scores', () => {
    expect(dailyAverage([2, 4])).toBe(3)
    expect(dailyAverage([-5, 5])).toBe(0)
  })

  it('returns null for no entries, never 0', () => {
    // Business rule 8. A zero would read as "I ate badly", not "I logged nothing".
    expect(dailyAverage([])).toBeNull()
  })
})

describe('business rule 9: a day below the entry minimum is incomplete', () => {
  it('is incomplete with fewer entries than the minimum, whatever the average', () => {
    expect(dayStatus(1, 5, SETTINGS)).toBe('incomplete')
    expect(dayStatus(1, -5, SETTINGS)).toBe('incomplete')
  })

  it('passes or misses once the minimum is met', () => {
    expect(dayStatus(2, 1.5, SETTINGS)).toBe('pass')
    expect(dayStatus(2, 0.5, SETTINGS)).toBe('miss')
  })

  it('treats an average exactly equal to the target as meeting it', () => {
    // Functional spec §3.3: "at or above this value".
    expect(dayStatus(2, 1, SETTINGS)).toBe('pass')
  })

  it('honours a minimum of 1, where no day can be incomplete', () => {
    expect(dayStatus(1, 2, { target: 1, minEntriesForValidDay: 1 })).toBe('pass')
  })
})

describe('summarizeDays', () => {
  const entries = [
    entry('2026-08-17', 3),
    entry('2026-08-17', 1),
    entry('2026-08-19', -2),
    entry('2026-08-19', -4),
    entry('2026-08-20', 5),
  ]

  it('groups by date, sorted ascending', () => {
    expect(summarizeDays(entries, SETTINGS).map((day) => day.date)).toEqual([
      '2026-08-17',
      '2026-08-19',
      '2026-08-20',
    ])
  })

  it('business rule 8: produces NO entry for a date with no entries', () => {
    // 2026-08-18 sits between two logged days and is simply absent -- there is no
    // placeholder object that could later be mistaken for a zero.
    const dates = summarizeDays(entries, SETTINGS).map((day) => day.date)
    expect(dates).not.toContain('2026-08-18')
  })

  it('classifies each day', () => {
    const byDate = new Map(summarizeDays(entries, SETTINGS).map((day) => [day.date, day]))
    expect(byDate.get('2026-08-17')).toMatchObject({ count: 2, average: 2, status: 'pass' })
    expect(byDate.get('2026-08-19')).toMatchObject({ count: 2, average: -3, status: 'miss' })
    expect(byDate.get('2026-08-20')).toMatchObject({ count: 1, status: 'incomplete' })
  })

  it('returns nothing for no entries at all', () => {
    expect(summarizeDays([], SETTINGS)).toEqual([])
  })
})

describe('classifyDays uses SQL rollups without recomputing the averages', () => {
  it('preserves the given average exactly', () => {
    const [day] = classifyDays([{ date: '2026-08-19', count: 3, average: 1.3333333 }], SETTINGS)
    expect(day?.average).toBe(1.3333333)
    expect(day?.status).toBe('pass')
  })
})

describe('periodStats', () => {
  const days = summarizeDays(
    [
      // complete, passes
      entry('2026-08-15', 3),
      entry('2026-08-15', 1),
      // complete, misses
      entry('2026-08-16', 0),
      entry('2026-08-16', -2),
      // incomplete: one entry only
      entry('2026-08-17', 5),
    ],
    SETTINGS,
  )

  it('business rule 9: excludes incomplete days from the average', () => {
    // The lone +5 would drag the average up to +1.83 if it counted.
    expect(periodStats(days, SETTINGS).average).toBe(0.5)
  })

  it('counts days on target out of COMPLETE days, not logged days', () => {
    const stats = periodStats(days, SETTINGS)
    expect(stats.daysOnTarget).toBe(1)
    expect(stats.completeDays).toBe(2)
    expect(stats.incompleteDays).toBe(1)
    expect(stats.loggedDays).toBe(3)
  })

  it('reports the pass/miss verdict against the target', () => {
    expect(periodStats(days, SETTINGS).meetsTarget).toBe(false)
    const good = summarizeDays([entry('2026-08-15', 2), entry('2026-08-15', 2)], SETTINGS)
    expect(periodStats(good, SETTINGS).meetsTarget).toBe(true)
  })

  it('reports an unknown verdict rather than a false one when nothing is comparable', () => {
    // An empty period, and a period of only incomplete days, are both "unknown"
    // -- reporting `false` would tell the user they missed a goal they never had
    // the chance to meet.
    expect(periodStats([], SETTINGS)).toMatchObject({ average: null, meetsTarget: null })
    const onlyIncomplete = summarizeDays([entry('2026-08-15', -5)], SETTINGS)
    expect(periodStats(onlyIncomplete, SETTINGS)).toMatchObject({
      average: null,
      meetsTarget: null,
      incompleteDays: 1,
      completeDays: 0,
    })
  })

  it('averages day-averages, not pooled entries', () => {
    // A 4-entry day and a 2-entry day must weigh the same, because the goal is
    // expressed as a daily average. Pooling would give 1.0 here instead of 1.5.
    const mixed = summarizeDays(
      [
        entry('2026-08-15', 0),
        entry('2026-08-15', 0),
        entry('2026-08-15', 0),
        entry('2026-08-15', 0),
        entry('2026-08-16', 3),
        entry('2026-08-16', 3),
      ],
      SETTINGS,
    )
    expect(periodStats(mixed, SETTINGS).average).toBe(1.5)
  })
})

describe('trendSeries', () => {
  const totals = [
    { date: '2026-08-15', count: 2, average: 2 },
    { date: '2026-08-18', count: 2, average: -1 },
  ]

  it('emits one point per date across the inclusive range', () => {
    expect(trendSeries(totals, '2026-08-15', '2026-08-18')).toHaveLength(4)
  })

  it('business rule 8: unlogged dates are null, so the chart draws a gap', () => {
    const points = trendSeries(totals, '2026-08-15', '2026-08-18')
    expect(points.map((point) => point.average)).toEqual([2, null, null, -1])
    expect(points.map((point) => point.count)).toEqual([2, 0, 0, 2])
  })

  it('returns nothing for an inverted range', () => {
    expect(trendSeries(totals, '2026-08-18', '2026-08-15')).toEqual([])
  })
})

describe('distribution', () => {
  it('always returns all eleven buckets so the axis reads -5..+5', () => {
    const buckets = distribution([])
    expect(buckets).toHaveLength(11)
    expect(buckets[0]).toEqual({ score: -5, count: 0 })
    expect(buckets[10]).toEqual({ score: 5, count: 0 })
  })

  it('counts entries at each score', () => {
    const byScore = new Map(distribution([3, 3, -1]).map((b) => [b.score, b.count]))
    expect(byScore.get(3)).toBe(2)
    expect(byScore.get(-1)).toBe(1)
    expect(byScore.get(0)).toBe(0)
  })

  it('business rule 9: entries from incomplete days still count here', () => {
    // Incomplete days are excluded from goal pass/fail, NOT from the distribution.
    // A single-entry day contributes its entry like any other.
    const lonely = summarizeDays([entry('2026-08-20', 4)], SETTINGS)
    expect(lonely[0]?.status).toBe('incomplete')
    const byScore = new Map(distribution([4]).map((b) => [b.score, b.count]))
    expect(byScore.get(4)).toBe(1)
  })

  it('ignores scores outside the scale instead of inventing a bucket', () => {
    expect(distribution([99, -99])).toHaveLength(11)
    expect(distribution([99, -99]).every((b) => b.count === 0)).toBe(true)
  })
})

describe('fillDistribution', () => {
  it('expands sparse SQL rows into the full eleven buckets', () => {
    const buckets = fillDistribution([
      { score: -2, count: 3 },
      { score: 4, count: 1 },
    ])
    expect(buckets).toHaveLength(11)
    expect(buckets.map((b) => b.score)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5])
    expect(buckets.find((b) => b.score === -2)?.count).toBe(3)
    expect(buckets.find((b) => b.score === 0)?.count).toBe(0)
  })
})

describe('eachDate', () => {
  it('is inclusive of both bounds', () => {
    expect(eachDate('2026-08-19', '2026-08-19')).toEqual(['2026-08-19'])
    expect(eachDate('2026-08-19', '2026-08-21')).toEqual([
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
    ])
  })

  it('crosses a month boundary', () => {
    expect(eachDate('2026-08-30', '2026-09-01')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ])
  })

  it('handles a leap day', () => {
    expect(eachDate('2028-02-28', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ])
  })

  it('never duplicates or skips a day across a DST transition', () => {
    // Stepping through UTC midnight is what guarantees this: these are plain
    // calendar dates, so a local clock change must not affect the sequence.
    // US spring-forward 2026 (Mar 8) and fall-back (Nov 1).
    const spring = eachDate('2026-03-07', '2026-03-09')
    expect(spring).toEqual(['2026-03-07', '2026-03-08', '2026-03-09'])
    const fall = eachDate('2026-10-31', '2026-11-02')
    expect(fall).toEqual(['2026-10-31', '2026-11-01', '2026-11-02'])
  })

  it('spans a 90-day dashboard period without drift', () => {
    const dates = eachDate('2026-06-01', '2026-08-29')
    expect(dates).toHaveLength(90)
    expect(dates.at(-1)).toBe('2026-08-29')
    expect(new Set(dates).size).toBe(90)
  })

  it('returns nothing for an inverted or unparseable range', () => {
    expect(eachDate('2026-08-21', '2026-08-19')).toEqual([])
    expect(eachDate('not-a-date', '2026-08-19')).toEqual([])
  })
})
