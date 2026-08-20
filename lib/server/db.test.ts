import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, resetDb, toParameterized } from './db'

describe('toParameterized', () => {
  it('turns interpolated values into bound parameters, never concatenation', () => {
    const id = "'; drop table users; --"
    const { text, params } = toParameterized(
      Object.assign(['select * from t where a = ', ' and b = ', ''], {
        raw: ['select * from t where a = ', ' and b = ', ''],
      }) as unknown as TemplateStringsArray,
      [id, 2],
    )
    expect(text).toBe('select * from t where a = $1 and b = $2')
    expect(params).toEqual([id, 2])
    // The dangerous string is a parameter, so it never reaches the parser as SQL.
    expect(text).not.toContain('drop table')
  })

  it('handles a template with no interpolations', () => {
    const { text, params } = toParameterized(
      Object.assign(['select 1'], { raw: ['select 1'] }) as unknown as TemplateStringsArray,
      [],
    )
    expect(text).toBe('select 1')
    expect(params).toEqual([])
  })
})

/**
 * Exercises the local fallback for real: a Postgres in WASM, the actual
 * migration files, the actual constraints. This is the mechanism that lets the
 * whole app run with no cloud account, so it is worth the couple of seconds it
 * costs to boot.
 */
describe('the local Postgres fallback', () => {
  const dataDir = resolve(process.cwd(), '.dev-data/pg')
  let sql: ReturnType<typeof db>

  beforeAll(async () => {
    // Start from an empty database so the migration run is exercised, not skipped.
    rmSync(dataDir, { recursive: true, force: true })
    // No DATABASE_URL and not deployed, so the fallback engages.
    delete process.env.DATABASE_URL
    process.env.NODE_ENV = 'test'
    delete process.env.VERCEL
    resetDb()
    sql = db()
    // Force the lazy open and the migration run.
    await sql`select 1`
  }, 60_000)

  afterAll(() => {
    resetDb()
  })

  it('applies db/migrations and records them', async () => {
    const rows = await sql<{ version: string }>`select version from schema_migrations order by version`
    expect(rows.map((row) => row.version)).toContain('001_init')
  })

  it('creates every table the schema declares', async () => {
    const rows = await sql<{ table_name: string }>`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `
    const names = rows.map((row) => row.table_name)
    expect(names).toEqual(
      expect.arrayContaining([
        'ai_usage',
        'allowlist',
        'food_entries',
        'prompts',
        'schema_migrations',
        'score_cache',
        'users',
      ]),
    )
  })

  it('has pgcrypto, so gen_random_uuid() defaults work', async () => {
    const [row] = await sql<{ id: string }>`
      insert into users (google_sub, email) values ('probe-sub', 'probe@example.com')
      returning id
    `
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  it('enforces the score range constraint', async () => {
    const [user] = await sql<{ id: string }>`select id from users where google_sub = 'probe-sub'`
    await expect(
      sql`insert into food_entries (user_id, entry_date, description, score, rationale)
          values (${user!.id}, current_date, 'probe', 99, 'probe')`,
    ).rejects.toThrow()
  })

  it('enforces the 200-character description limit', async () => {
    const [user] = await sql<{ id: string }>`select id from users where google_sub = 'probe-sub'`
    await expect(
      sql`insert into food_entries (user_id, entry_date, description, score, rationale)
          values (${user!.id}, current_date, ${'x'.repeat(201)}, 0, 'probe')`,
    ).rejects.toThrow()
  })

  it('cascades entry deletion when a user is deleted', async () => {
    const [user] = await sql<{ id: string }>`
      insert into users (google_sub, email) values ('cascade-sub', 'cascade@example.com')
      returning id
    `
    await sql`insert into food_entries (user_id, entry_date, description, score, rationale)
              values (${user!.id}, current_date, 'to be cascaded', 1, 'probe')`
    await sql`delete from users where id = ${user!.id}`
    const left = await sql<{ n: number }>`
      select count(*)::int as n from food_entries where user_id = ${user!.id}
    `
    expect(left[0]?.n).toBe(0)
  })

  it('binds interpolated values as parameters', async () => {
    const evil = "'; drop table users; --"
    const [row] = await sql<{ v: string }>`select ${evil}::text as v`
    expect(row?.v).toBe(evil)
    // If it had been concatenated, users would be gone.
    const [check] = await sql<{ n: number }>`select count(*)::int as n from users`
    expect(check?.n).toBeGreaterThan(0)
  })
})
