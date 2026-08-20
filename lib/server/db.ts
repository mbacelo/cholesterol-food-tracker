import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'
import { ApiError, ConfigError } from './errors.js'
import { isLocalEnvironment } from './env.js'

/**
 * The only file that knows how we talk to Postgres.
 *
 * Production is Neon over the HTTP driver, so there is no connection pooler and
 * no connect/close lifecycle -- each statement is one fetch. Two consequences the
 * callers must respect: never loop a query per row, and there are no interactive
 * transactions, so anything atomic has to be a single statement.
 *
 * Locally, when DATABASE_URL is absent, this falls back to PGlite -- a real
 * Postgres compiled to WASM, running in-process and persisted under .dev-data/.
 * That is what lets the whole app run with no cloud account. It is a real
 * Postgres, so the migrations, constraints and cascades under test are the same
 * ones production enforces. The fallback is refused outright in any deployed
 * environment: there, a missing DATABASE_URL is a configuration error.
 */

export type Row = Record<string, unknown>

/**
 * A tagged-template query returning a plain rows array.
 *
 * Values interpolated into the template become bound parameters -- never string
 * concatenation -- so this shape is also what keeps SQL injection off the table.
 */
export type Sql = <T = Row>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>

let cached: Sql | undefined

export function db(): Sql {
  if (cached) return cached

  const url = process.env.DATABASE_URL
  if (url) {
    const query = neon(url)
    cached = (async <T = Row>(strings: TemplateStringsArray, ...values: unknown[]) => {
      // The Neon HTTP driver returns a plain rows array by default.
      return (await query(strings, ...values)) as unknown as T[]
    }) as Sql
    return cached
  }

  if (!isLocalEnvironment()) {
    throw new ConfigError('DATABASE_URL is not set')
  }

  cached = localSql()
  return cached
}

/** Resets the memoized client. Tests only. */
export function resetDb(): void {
  cached = undefined
  localDb = undefined
}

/**
 * Turns a tagged template into a parameterized statement.
 *
 * Built by hand rather than using PGlite's own `.sql` helper so the parameter
 * numbering and the rows-array result exactly match the Neon driver's
 * behaviour -- the point of the fallback is that callers cannot tell which one
 * they are talking to.
 */
export function toParameterized(
  strings: TemplateStringsArray,
  values: unknown[],
): { text: string; params: unknown[] } {
  let text = ''
  for (let i = 0; i < strings.length; i += 1) {
    text += strings[i]
    if (i < values.length) text += `$${i + 1}`
  }
  return { text, params: values }
}

type LocalDatabase = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(text: string): Promise<unknown>
}

let localDb: Promise<LocalDatabase> | undefined

function localSql(): Sql {
  return (async <T = Row>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const instance = await (localDb ??= openLocalDatabase())
    const { text, params } = toParameterized(strings, values)
    const result = await instance.query<T>(text, params)
    return result.rows
  }) as Sql
}

async function openLocalDatabase(): Promise<LocalDatabase> {
  // Both specifiers are held in variables on purpose: a literal dynamic import
  // would be statically analysable, and esbuild would bundle this large WASM dev
  // dependency into every deployed function even though the guard in db() makes
  // the branch unreachable there.
  const corePackage = '@electric-sql/pglite'
  const cryptoPackage = '@electric-sql/pglite/contrib/pgcrypto'
  const [core, crypto] = await Promise.all([
    import(corePackage) as Promise<{ PGlite: PGliteFactory }>,
    import(cryptoPackage) as Promise<{ pgcrypto: unknown }>,
  ])

  const dataDir = resolve(process.cwd(), '.dev-data/pg')
  // PGlite does not create parent directories.
  mkdirSync(dataDir, { recursive: true })

  // pgcrypto is not in PGlite's base bundle, and 001_init.sql opens with
  // `create extension pgcrypto`. Loading the contrib extension lets the
  // migration files run here byte-for-byte as they will in Neon, rather than
  // maintaining a second, subtly different schema for local development.
  const instance = await core.PGlite.create({
    dataDir,
    extensions: { pgcrypto: crypto.pgcrypto },
  })
  await applyMigrations(instance)
  console.log(
    `[db] no DATABASE_URL -- using the local in-process Postgres at .dev-data/pg. ` +
      `Set DATABASE_URL in .env.local to use Neon instead.`,
  )
  return instance
}

interface PGliteFactory {
  create(options: {
    dataDir: string
    extensions?: Record<string, unknown>
  }): Promise<LocalDatabase>
}

/**
 * Applies every db/migrations/*.sql the local database has not seen.
 *
 * Deployed databases are migrated by hand in the Neon SQL editor, as the spec
 * requires. This exists so a fresh clone has a working database on first run
 * without a manual step, and it reads the same files, in the same order.
 */
async function applyMigrations(instance: LocalDatabase): Promise<void> {
  const dir = migrationsDir()
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  let applied = new Set<string>()
  try {
    const rows = await instance.query<{ version: string }>('select version from schema_migrations')
    applied = new Set(rows.rows.map((row) => row.version))
  } catch {
    // schema_migrations does not exist yet: this is a fresh database.
  }

  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    if (applied.has(version)) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    try {
      await instance.exec(sql)
      console.log(`[db] applied migration ${version}`)
    } catch (err) {
      // Loud, and fatal: a half-migrated dev database produces confusing
      // failures much later, far from the cause.
      throw new ApiError(500, 'internal_error', `migration ${version} failed: ${String(err)}`)
    }
  }
}

function migrationsDir(): string {
  // Resolve relative to this module so the path holds regardless of cwd.
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../db/migrations')
}

/** The first row, or undefined. */
export function one<T>(rows: T[]): T | undefined {
  return rows[0]
}

/**
 * The first row, or a 404.
 *
 * Every single-row read and every update or delete in entries.ts goes through
 * this. Zero rows there means "no such entry FOR THIS USER", which must be a
 * 404 and never a silent success.
 */
export function oneOr404<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new ApiError(404, 'not_found')
  return row
}
