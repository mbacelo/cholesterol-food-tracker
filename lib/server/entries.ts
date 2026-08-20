import { randomUUID } from 'node:crypto'
import { analyze } from '../ai/analyze.js'
import type { Factor } from '../ai/schemas.js'
import { db, oneOr404 } from './db.js'
import { ApiError } from './errors.js'
import * as blob from './blob.js'
import { isFutureLocalDate } from '../dates.js'

/**
 * THE DATA-ISOLATION BOUNDARY (tech spec §4).
 *
 * Every statement against food_entries lives in this file. No endpoint handler
 * writes SQL against that table -- scripts/audit-isolation.mjs fails the build if
 * one does.
 *
 * Two rules, and they are the entire reason the file exists:
 *
 *   1. Every exported function takes `userId` FIRST.
 *   2. Every statement carries `where user_id = ${userId}`, including updates and
 *      deletes. A `where id = ...` without `user_id` is the whole bug class this
 *      file exists to prevent.
 *
 * `userId` comes only from the verified session. A user_id in a request body is
 * rejected by the .strict() Zod schemas before it ever reaches here.
 *
 * Zero rows returned is a 404, never a silent success: for a get, update or
 * delete it means "no such entry FOR THIS USER", which is indistinguishable from
 * "does not exist" by design -- probing another user's id must not be able to
 * tell the difference.
 */

export interface EntryPublic {
  id: string
  entry_date: string
  description: string
  is_homemade: boolean
  score: number
  rationale: string
  positive_factors: Factor[]
  negative_factors: Factor[]
  /** Whether a photo exists. The R2 key itself never leaves this file. */
  has_image: boolean
  created_at: string
  updated_at: string
}

interface EntryRow extends EntryPublic {
  image_key: string | null
}

export interface ImageBytes {
  base64: string
  contentType: 'image/jpeg'
}

export interface CreateEntryInput {
  entryDate: string
  tzOffsetMinutes: number
  description: string
  isHomemade: boolean
  image?: ImageBytes
}

export interface EntryPatch {
  entryDate?: string
  description?: string
  isHomemade?: boolean
  tzOffsetMinutes: number
}

export interface Cursor {
  entry_date: string
  created_at: string
}

/** Strips image_key, so it cannot escape this module by accident. */
function toPublic(row: EntryRow): EntryPublic {
  const { image_key, ...rest } = row
  return { ...rest, has_image: image_key !== null }
}

/**
 * Whether a patch requires a re-score.
 *
 * PURE and unit-tested, and the single place this decision is made (tech spec
 * §7): a change to description or is_homemade re-scores; a date-only change does
 * not. Descriptions are compared after normalizing whitespace, so re-typing the
 * same words with different spacing does not trigger a paid call.
 */
export function needsRescore(
  previous: { description: string; is_homemade: boolean },
  patch: EntryPatch,
): boolean {
  if (patch.isHomemade !== undefined && patch.isHomemade !== previous.is_homemade) return true
  if (patch.description !== undefined) {
    const before = previous.description.trim().replace(/\s+/g, ' ')
    const after = patch.description.trim().replace(/\s+/g, ' ')
    if (before !== after) return true
  }
  return false
}

function assertNotFuture(date: string, tzOffsetMinutes: number): void {
  // Business rule 2. Enforced against the CALLER's local today, not the
  // server's; the database constraint carries a day of slack as a backstop.
  if (isFutureLocalDate(date, tzOffsetMinutes)) {
    throw new ApiError(400, 'bad_request', 'entry_date cannot be in the future', true)
  }
}

/**
 * Creates an entry.
 *
 * Ordering matters, and is chosen so no failure can leave a bad row:
 *   1. generate the id here, so the image key is known before the insert;
 *   2. score it -- an entry without a score must never exist;
 *   3. write the image;
 *   4. insert;
 *   5. if the insert fails, remove the object we just wrote.
 */
export async function createEntry(
  userId: string,
  email: string,
  input: CreateEntryInput,
): Promise<EntryPublic> {
  assertNotFuture(input.entryDate, input.tzOffsetMinutes)

  const entryId = randomUUID()

  const result = await analyze({
    description: input.description,
    isHomemade: input.isHomemade,
    email,
    localDay: input.entryDate,
  })

  let imageKey: string | null = null
  if (input.image) {
    imageKey = blob.entryImageKey(userId, entryId)
    await blob.put(imageKey, Buffer.from(input.image.base64, 'base64'), input.image.contentType)
  }

  try {
    const rows = await db()<EntryRow>`
      insert into food_entries (
        id, user_id, entry_date, description, is_homemade,
        score, rationale, positive_factors, negative_factors, image_key
      ) values (
        ${entryId}, ${userId}, ${input.entryDate}, ${result.description}, ${input.isHomemade},
        ${result.score}, ${result.rationale},
        ${JSON.stringify(result.positiveFactors)}::jsonb,
        ${JSON.stringify(result.negativeFactors)}::jsonb,
        ${imageKey}
      )
      returning id, entry_date::text as entry_date, description, is_homemade, score, rationale,
                positive_factors, negative_factors, image_key, created_at, updated_at
    `
    return toPublic(oneOr404(rows))
  } catch (err) {
    if (imageKey) {
      // Do not leave an orphaned object behind.
      await blob.remove(imageKey).catch(() => undefined)
    }
    throw err
  }
}

export async function listEntriesForDate(userId: string, date: string): Promise<EntryPublic[]> {
  const rows = await db()<EntryRow>`
    select id, entry_date::text as entry_date, description, is_homemade, score, rationale,
           positive_factors, negative_factors, image_key, created_at, updated_at
      from food_entries
     where user_id = ${userId} and entry_date = ${date}
     order by created_at asc
  `
  return rows.map(toPublic)
}

export interface ListResult {
  items: EntryPublic[]
  cursor: Cursor | null
  /** Full-day count and average for every date present in this page. */
  dayMeta: Record<string, { count: number; average: number }>
}

/**
 * Keyset page for History.
 *
 * Keyset on (entry_date desc, created_at desc), matching the index exactly. One
 * extra row is fetched to detect "has more" without a count(*).
 *
 * `dayMeta` carries the FULL-day count and average for every date in the page.
 * Without it a day split across a page boundary would render an average computed
 * from half its entries, which is simply wrong.
 */
export async function listEntries(
  userId: string,
  options: { limit: number; search?: string; cursor?: Cursor },
): Promise<ListResult> {
  const limit = Math.min(Math.max(options.limit, 1), 100)
  const search = options.search && options.search.trim().length > 0 ? options.search.trim() : null
  const cursorDate = options.cursor?.entry_date ?? null
  const cursorCreated = options.cursor?.created_at ?? null

  const rows = await db()<EntryRow>`
    select id, entry_date::text as entry_date, description, is_homemade, score, rationale,
           positive_factors, negative_factors, image_key, created_at, updated_at
      from food_entries
     where user_id = ${userId}
       and (${search}::text is null or description ilike '%' || ${search}::text || '%')
       and (
         ${cursorDate}::date is null
         or (entry_date, created_at) < (${cursorDate}::date, ${cursorCreated}::timestamptz)
       )
     order by entry_date desc, created_at desc
     limit ${limit + 1}
  `

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items.at(-1)

  const dates = [...new Set(items.map((row) => row.entry_date))]
  const dayMeta: Record<string, { count: number; average: number }> = {}
  if (dates.length > 0) {
    const meta = await db()<{ entry_date: string; n: number; avg: number }>`
      select entry_date::text as entry_date, count(*)::int as n, avg(score)::float as avg
        from food_entries
       where user_id = ${userId} and entry_date = any(${dates}::date[])
       group by entry_date
    `
    for (const row of meta) dayMeta[row.entry_date] = { count: row.n, average: row.avg }
  }

  return {
    items: items.map(toPublic),
    cursor: hasMore && last ? { entry_date: last.entry_date, created_at: last.created_at } : null,
    dayMeta,
  }
}

export async function getEntry(userId: string, entryId: string): Promise<EntryPublic> {
  const rows = await db()<EntryRow>`
    select id, entry_date::text as entry_date, description, is_homemade, score, rationale,
           positive_factors, negative_factors, image_key, created_at, updated_at
      from food_entries
     where id = ${entryId} and user_id = ${userId}
  `
  return toPublic(oneOr404(rows))
}

/**
 * The R2 key for an entry's photo.
 *
 * Ownership is verified in Postgres HERE, before any URL is signed. The
 * {user_id}/ prefix in the key is organizational, not a security control.
 */
export async function getEntryImageKey(userId: string, entryId: string): Promise<string> {
  const rows = await db()<{ image_key: string | null }>`
    select image_key from food_entries where id = ${entryId} and user_id = ${userId}
  `
  const row = oneOr404(rows)
  if (!row.image_key) throw new ApiError(404, 'not_found')
  return row.image_key
}

export interface UpdateResult {
  entry: EntryPublic
  rescored: boolean
}

/**
 * Updates the date, description and homemade flag. Nothing else is patchable.
 *
 * The re-score decision lives here and nowhere else, so it cannot be
 * accidentally skipped by a second code path.
 */
export async function updateEntry(
  userId: string,
  email: string,
  entryId: string,
  patch: EntryPatch,
): Promise<UpdateResult> {
  if (patch.entryDate !== undefined) assertNotFuture(patch.entryDate, patch.tzOffsetMinutes)

  const current = await getEntry(userId, entryId)
  const rescore = needsRescore(
    { description: current.description, is_homemade: current.is_homemade },
    patch,
  )

  const entryDate = patch.entryDate ?? current.entry_date

  if (!rescore) {
    // A date-only change. No model call.
    const rows = await db()<EntryRow>`
      update food_entries
         set entry_date = ${entryDate}, updated_at = now()
       where id = ${entryId} and user_id = ${userId}
      returning id, entry_date::text as entry_date, description, is_homemade, score, rationale,
                positive_factors, negative_factors, image_key, created_at, updated_at
    `
    return { entry: toPublic(oneOr404(rows)), rescored: false }
  }

  const description = patch.description ?? current.description
  const isHomemade = patch.isHomemade ?? current.is_homemade

  const result = await analyze({
    description,
    isHomemade,
    email,
    localDay: entryDate,
  })

  const rows = await db()<EntryRow>`
    update food_entries
       set entry_date = ${entryDate},
           description = ${result.description},
           is_homemade = ${isHomemade},
           score = ${result.score},
           rationale = ${result.rationale},
           positive_factors = ${JSON.stringify(result.positiveFactors)}::jsonb,
           negative_factors = ${JSON.stringify(result.negativeFactors)}::jsonb,
           updated_at = now()
     where id = ${entryId} and user_id = ${userId}
    returning id, entry_date::text as entry_date, description, is_homemade, score, rationale,
              positive_factors, negative_factors, image_key, created_at, updated_at
  `
  return { entry: toPublic(oneOr404(rows)), rescored: true }
}

/** Deletes the row, then its photo. */
export async function deleteEntry(userId: string, entryId: string): Promise<void> {
  const rows = await db()<{ image_key: string | null }>`
    delete from food_entries where id = ${entryId} and user_id = ${userId}
    returning image_key
  `
  const row = oneOr404(rows)
  if (row.image_key) {
    // A stray object is harmless; a 500 on an otherwise successful delete is not.
    await blob.remove(row.image_key).catch((err) => {
      console.error('[entries] failed to remove image after delete', err)
    })
  }
}

export interface DayTotalsRow {
  date: string
  count: number
  average: number
}

/** Daily averages for a period, aggregated in SQL (tech spec §8). */
export async function dailyAverages(
  userId: string,
  from: string,
  to: string,
): Promise<DayTotalsRow[]> {
  const rows = await db()<{ entry_date: string; n: number; avg: number }>`
    select entry_date::text as entry_date, count(*)::int as n, avg(score)::float as avg
      from food_entries
     where user_id = ${userId} and entry_date between ${from} and ${to}
     group by entry_date
     order by entry_date
  `
  return rows.map((row) => ({ date: row.entry_date, count: row.n, average: row.avg }))
}

export async function scoreDistribution(
  userId: string,
  from: string,
  to: string,
): Promise<{ score: number; count: number }[]> {
  const rows = await db()<{ score: number; n: number }>`
    select score, count(*)::int as n
      from food_entries
     where user_id = ${userId} and entry_date between ${from} and ${to}
     group by score
  `
  return rows.map((row) => ({ score: row.score, count: row.n }))
}

export interface CsvRow {
  entry_date: string
  description: string
  is_homemade: boolean
  score: number
  rationale: string
}

export async function csvRows(userId: string): Promise<CsvRow[]> {
  return db()<CsvRow>`
    select entry_date::text as entry_date, description, is_homemade, score, rationale
      from food_entries
     where user_id = ${userId}
     order by entry_date desc, created_at desc
  `
}

/**
 * How many entries a user has.
 *
 * The ONLY thing the admin surface may learn about food data, besides the
 * cascade delete. A count is not content.
 */
export async function countEntriesForUser(userId: string): Promise<number> {
  const rows = await db()<{ n: number }>`
    select count(*)::int as n from food_entries where user_id = ${userId}
  `
  return rows[0]?.n ?? 0
}
