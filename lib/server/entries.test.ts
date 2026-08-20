import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, resetDb } from './db'
import {
  createEntry,
  deleteEntry,
  getEntry,
  getEntryImageKey,
  listEntries,
  listEntriesForDate,
  needsRescore,
  updateEntry,
} from './entries'
import { resetBursts } from './usage'

const ALICE = { email: 'alice@example.com', sub: 'alice-sub' }
const BOB = { email: 'bob@example.com', sub: 'bob-sub' }

let aliceId = ''
let bobId = ''

async function seedUser(user: { email: string; sub: string }): Promise<string> {
  const rows = await db()<{ id: string }>`
    insert into users (google_sub, email) values (${user.sub}, ${user.email})
    on conflict (google_sub) do update set email = excluded.email
    returning id
  `
  return rows[0]!.id
}

/** Today in UTC, which is what tz offset 0 means. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

beforeAll(async () => {
  delete process.env.DATABASE_URL
  delete process.env.VERCEL
  process.env.NODE_ENV = 'test'
  process.env.AI_PROVIDER = 'mock'
  process.env.AI_MODEL = 'mock-deterministic-1'
  process.env.AI_DAILY_CALL_LIMIT = '10000'
  resetDb()
  await db()`select 1`
  aliceId = await seedUser(ALICE)
  bobId = await seedUser(BOB)
}, 60_000)

beforeEach(async () => {
  resetBursts()
  await db()`delete from food_entries`
  await db()`delete from score_cache`
  await db()`delete from ai_usage`
})

async function makeEntry(userId: string, email: string, description: string, date = today()) {
  return createEntry(userId, email, {
    entryDate: date,
    tzOffsetMinutes: 0,
    description,
    isHomemade: true,
  })
}

describe('needsRescore is the single re-score decision (business rule 6)', () => {
  const previous = { description: 'Grilled chicken and rice', is_homemade: true }

  it('re-scores when the description changes', () => {
    expect(needsRescore(previous, { description: 'Fried chicken', tzOffsetMinutes: 0 })).toBe(true)
  })

  it('re-scores when the homemade flag changes', () => {
    expect(needsRescore(previous, { isHomemade: false, tzOffsetMinutes: 0 })).toBe(true)
  })

  it('does NOT re-score a date-only change', () => {
    expect(needsRescore(previous, { entryDate: '2026-08-01', tzOffsetMinutes: 0 })).toBe(false)
  })

  it('does NOT re-score when a field is resubmitted unchanged', () => {
    expect(
      needsRescore(previous, {
        description: 'Grilled chicken and rice',
        isHomemade: true,
        tzOffsetMinutes: 0,
      }),
    ).toBe(false)
  })

  it('ignores whitespace-only differences, so no paid call is wasted', () => {
    expect(
      needsRescore(previous, { description: '  Grilled   chicken and rice ', tzOffsetMinutes: 0 }),
    ).toBe(false)
  })
})

describe('DATA ISOLATION: one user can never reach another user’s entry', () => {
  it('getEntry with another user’s id is a 404, not their data', async () => {
    const entry = await makeEntry(aliceId, ALICE.email, 'Lentil soup')
    await expect(getEntry(bobId, entry.id)).rejects.toMatchObject({ status: 404 })
    // And Alice can still read it, so the 404 is about ownership, not existence.
    await expect(getEntry(aliceId, entry.id)).resolves.toMatchObject({ id: entry.id })
  })

  it('updateEntry with another user’s id changes nothing', async () => {
    const entry = await makeEntry(aliceId, ALICE.email, 'Lentil soup')
    await expect(
      updateEntry(bobId, BOB.email, entry.id, { description: 'Hijacked', tzOffsetMinutes: 0 }),
    ).rejects.toMatchObject({ status: 404 })

    const untouched = await getEntry(aliceId, entry.id)
    expect(untouched.description).toBe('Lentil soup')
  })

  it('deleteEntry with another user’s id deletes nothing', async () => {
    const entry = await makeEntry(aliceId, ALICE.email, 'Lentil soup')
    await expect(deleteEntry(bobId, entry.id)).rejects.toMatchObject({ status: 404 })
    await expect(getEntry(aliceId, entry.id)).resolves.toMatchObject({ id: entry.id })
  })

  it('getEntryImageKey with another user’s id is a 404', async () => {
    const entry = await makeEntry(aliceId, ALICE.email, 'Lentil soup')
    await expect(getEntryImageKey(bobId, entry.id)).rejects.toMatchObject({ status: 404 })
  })

  it('lists never include another user’s entries', async () => {
    await makeEntry(aliceId, ALICE.email, 'Alice lentils')
    await makeEntry(bobId, BOB.email, 'Bob bacon sandwich')

    const aliceDay = await listEntriesForDate(aliceId, today())
    expect(aliceDay).toHaveLength(1)
    expect(aliceDay[0]?.description).toBe('Alice lentils')

    const alicePage = await listEntries(aliceId, { limit: 50 })
    expect(alicePage.items).toHaveLength(1)

    // Search must not be a hole in the isolation either.
    const searched = await listEntries(aliceId, { limit: 50, search: 'bacon' })
    expect(searched.items).toHaveLength(0)
  })
})

describe('entries never expose the image key', () => {
  it('returns has_image instead of image_key', async () => {
    const entry = await makeEntry(aliceId, ALICE.email, 'Lentil soup')
    expect(entry).not.toHaveProperty('image_key')
    expect(entry.has_image).toBe(false)
  })
})

describe('creating an entry', () => {
  it('always stores an integer score and a non-empty rationale', async () => {
    const entry = await makeEntry(aliceId, ALICE.email, 'Milanesa fried with cheese and white rice')
    expect(Number.isInteger(entry.score)).toBe(true)
    expect(entry.score).toBeGreaterThanOrEqual(-5)
    expect(entry.score).toBeLessThanOrEqual(5)
    expect(entry.rationale.length).toBeGreaterThan(0)
    expect(entry.negative_factors.length).toBeGreaterThan(0)
  })

  it('rejects a future date in the caller’s own timezone (business rule 2)', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    await expect(
      createEntry(aliceId, ALICE.email, {
        entryDate: tomorrow,
        tzOffsetMinutes: 0,
        description: 'Tomorrow lunch',
        isHomemade: true,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('accepts a past date', async () => {
    const entry = await makeEntry(aliceId, ALICE.email, 'Old lentils', '2026-01-15')
    expect(entry.entry_date).toBe('2026-01-15')
  })
})

describe('updating an entry', () => {
  it('re-scores a description change and reports that it did', async () => {
    const entry = await makeEntry(aliceId, ALICE.email, 'Ensalada de garbanzos con aceite de oliva')
    expect(entry.score).toBeGreaterThan(0)

    const result = await updateEntry(aliceId, ALICE.email, entry.id, {
      description: 'Milanesa fried with cheese and white rice',
      tzOffsetMinutes: 0,
    })
    expect(result.rescored).toBe(true)
    expect(result.entry.score).toBeLessThan(entry.score)
    expect(result.entry.rationale).not.toBe(entry.rationale)
  })

  it('does not re-score, or change the score, on a date-only edit', async () => {
    const entry = await makeEntry(aliceId, ALICE.email, 'Lentil soup with carrots')
    const result = await updateEntry(aliceId, ALICE.email, entry.id, {
      entryDate: '2026-02-02',
      tzOffsetMinutes: 0,
    })
    expect(result.rescored).toBe(false)
    expect(result.entry.score).toBe(entry.score)
    expect(result.entry.rationale).toBe(entry.rationale)
    expect(result.entry.entry_date).toBe('2026-02-02')
  })

  it('re-scores when only the homemade flag flips', async () => {
    const entry = await makeEntry(aliceId, ALICE.email, 'Chicken with rice')
    const result = await updateEntry(aliceId, ALICE.email, entry.id, {
      isHomemade: false,
      tzOffsetMinutes: 0,
    })
    expect(result.rescored).toBe(true)
    expect(result.entry.is_homemade).toBe(false)
  })
})

describe('History pagination', () => {
  beforeEach(async () => {
    // Three days, two entries each.
    for (const date of ['2026-08-10', '2026-08-11', '2026-08-12']) {
      await makeEntry(aliceId, ALICE.email, `Lentils on ${date}`, date)
      await makeEntry(aliceId, ALICE.email, `Salad on ${date}`, date)
    }
  })

  it('pages by keyset, newest first, without repeating or skipping', async () => {
    const first = await listEntries(aliceId, { limit: 4 })
    expect(first.items).toHaveLength(4)
    expect(first.cursor).not.toBeNull()

    const second = await listEntries(aliceId, { limit: 4, cursor: first.cursor! })
    expect(second.items).toHaveLength(2)
    expect(second.cursor).toBeNull()

    const ids = [...first.items, ...second.items].map((entry) => entry.id)
    expect(new Set(ids).size).toBe(6)
    const dates = [...first.items, ...second.items].map((entry) => entry.entry_date)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it('reports FULL-day meta, so a day split across a page still averages correctly', async () => {
    // The page boundary falls inside 2026-08-11, but its meta must describe both
    // of that day's entries, not just the one on this page.
    const page = await listEntries(aliceId, { limit: 3 })
    const meta = page.dayMeta['2026-08-11']
    expect(meta?.count).toBe(2)
  })

  it('searches descriptions case-insensitively', async () => {
    const found = await listEntries(aliceId, { limit: 50, search: 'SALAD' })
    expect(found.items).toHaveLength(3)
  })
})
