import { toCsv } from '../lib/csv.js'
import { localDayFromOffset } from '../lib/dates.js'
import { csvRows } from '../lib/server/entries.js'
import { assertMethod, handleError } from '../lib/server/errors.js'
import { queryParam, type ApiRequest, type ApiResponse } from '../lib/server/http.js'
import { zTzOffset } from '../lib/requests.js'
import { requireUser } from '../lib/server/session.js'

/** All of the caller's entries as CSV (functional spec §6.8). */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['GET'])
    const user = await requireUser(req, res)

    const offset = zTzOffset.parse(Number(queryParam(req, 'tz_offset_minutes') ?? 0))
    const today = localDayFromOffset(offset)

    const rows = await csvRows(user.id)
    const csv = toCsv(
      ['date', 'description', 'is_homemade', 'score', 'rationale'],
      rows.map((row) => [
        row.entry_date,
        row.description,
        row.is_homemade,
        row.score,
        row.rationale,
      ]),
    )

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="food-entries-${today}.csv"`)
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(csv)
  } catch (err) {
    return handleError(res, err, 'GET /api/export')
  }
}
