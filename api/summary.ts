import { classifyDays, fillDistribution, periodStats, trendSeries } from '../domain/aggregation.js'
import { localDayFromOffset, periodStart } from '../lib/dates.js'
import { dailyAverages, scoreDistribution } from '../lib/server/entries.js'
import { assertMethod, handleError } from '../lib/server/errors.js'
import { queryParam, type ApiRequest, type ApiResponse } from '../lib/server/http.js'
import { zPeriod, zTzOffset } from '../lib/requests.js'
import { requireUser } from '../lib/server/session.js'
import { getSettings } from '../lib/server/users.js'

/**
 * Dashboard aggregates.
 *
 * Aggregated in SQL over the period rather than shipped as entries and reduced in
 * the browser (tech spec §8): the client has no need for descriptions or image
 * keys here, and sending 90 days of entries to compute eleven bar heights would
 * be both slower and a needless widening of what leaves the server.
 *
 * Every derived figure comes from domain/aggregation.ts. Nothing is averaged in
 * this file.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['GET'])
    const user = await requireUser(req, res)

    const days = zPeriod.parse(Number(queryParam(req, 'days') ?? 30))
    const offset = zTzOffset.parse(Number(queryParam(req, 'tz_offset_minutes') ?? 0))

    const to = localDayFromOffset(offset)
    const from = periodStart(days, offset)

    const settings = await getSettings(user.id)
    const goal = {
      target: settings.daily_average_target,
      minEntriesForValidDay: settings.min_entries_for_valid_day,
    }

    const [totals, distributionRows] = await Promise.all([
      dailyAverages(user.id, from, to),
      scoreDistribution(user.id, from, to),
    ])

    const summaries = classifyDays(totals, goal)
    const stats = periodStats(summaries, goal)

    res.status(200).json({
      from,
      to,
      days,
      target: goal.target,
      min_entries_for_valid_day: goal.minEntriesForValidDay,
      // One point per date, with null on days that were never logged, so the
      // chart draws a gap rather than a dip to zero (business rule 8).
      trend: trendSeries(totals, from, to),
      distribution: fillDistribution(distributionRows),
      period: stats,
    })
  } catch (err) {
    return handleError(res, err, 'GET /api/summary')
  }
}
