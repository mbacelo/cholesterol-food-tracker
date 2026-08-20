import {
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  listEntriesForDate,
  updateEntry,
} from '../lib/server/entries.js'
import { assertMethod, handleError } from '../lib/server/errors.js'
import { queryParam, type ApiRequest, type ApiResponse } from '../lib/server/http.js'
import { zCreateEntry, zLocalDate, zPatchEntry, zUuid } from '../lib/requests.js'
import { requireUser } from '../lib/server/session.js'
import { assertBurst } from '../lib/server/usage.js'

/**
 * The entries collection.
 *
 * Methods are multiplexed into one file deliberately: every file under api/ is a
 * separate serverless function and Vercel Hobby allows twelve.
 *
 * No SQL here. Everything goes through lib/server/entries.ts, the file that
 * guarantees every statement carries the caller's own user_id.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['GET', 'POST', 'PATCH', 'DELETE'])
    const user = await requireUser(req, res)

    switch (req.method) {
      case 'GET':
        return await read(req, res, user.id)
      case 'POST':
        return await create(req, res, user.id, user.email)
      case 'PATCH':
        return await patch(req, res, user.id, user.email)
      default:
        return await destroy(req, res, user.id)
    }
  } catch (err) {
    return handleError(res, err, `${req.method} /api/entries`)
  }
}

async function read(req: ApiRequest, res: ApiResponse, userId: string): Promise<void> {
  const id = queryParam(req, 'id')
  if (id) {
    const entry = await getEntry(userId, zUuid.parse(id))
    res.status(200).json({ entry })
    return
  }

  const date = queryParam(req, 'date')
  if (date) {
    const entries = await listEntriesForDate(userId, zLocalDate.parse(date))
    res.status(200).json({ entries })
    return
  }

  const rawLimit = Number(queryParam(req, 'limit') ?? 30)
  const search = queryParam(req, 'q')
  const cursorDate = queryParam(req, 'cursor_date')
  const cursorCreated = queryParam(req, 'cursor_created_at')

  const page = await listEntries(userId, {
    limit: Number.isFinite(rawLimit) ? rawLimit : 30,
    ...(search ? { search } : {}),
    ...(cursorDate && cursorCreated
      ? { cursor: { entry_date: cursorDate, created_at: cursorCreated } }
      : {}),
  })

  res.status(200).json({
    entries: page.items,
    cursor: page.cursor,
    day_meta: page.dayMeta,
  })
}

async function create(
  req: ApiRequest,
  res: ApiResponse,
  userId: string,
  email: string,
): Promise<void> {
  // Validation runs before the rate limiter here, because the limiter needs a
  // validated tz_offset_minutes to know which local day to charge. Elsewhere the
  // skeleton order is unchanged.
  const body = zCreateEntry.parse(req.body)
  assertBurst(email)

  const entry = await createEntry(userId, email, {
    entryDate: body.entry_date,
    tzOffsetMinutes: body.tz_offset_minutes,
    description: body.description,
    isHomemade: body.is_homemade,
  })
  res.status(201).json({ entry })
}

async function patch(
  req: ApiRequest,
  res: ApiResponse,
  userId: string,
  email: string,
): Promise<void> {
  const id = zUuid.parse(queryParam(req, 'id'))
  const body = zPatchEntry.parse(req.body)
  assertBurst(email)

  const result = await updateEntry(userId, email, id, {
    tzOffsetMinutes: body.tz_offset_minutes,
    ...(body.entry_date !== undefined ? { entryDate: body.entry_date } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.is_homemade !== undefined ? { isHomemade: body.is_homemade } : {}),
  })
  res.status(200).json({ entry: result.entry, rescored: result.rescored })
}

async function destroy(req: ApiRequest, res: ApiResponse, userId: string): Promise<void> {
  await deleteEntry(userId, zUuid.parse(queryParam(req, 'id')))
  res.status(204).send('')
}
