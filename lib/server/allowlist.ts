import { db } from './db.js'
import { emailList } from './env.js'
import { ApiError } from './errors.js'

/**
 * Who is allowed in (tech spec §5).
 *
 * Two server-side sources, with a deliberate precedence:
 *
 *   - An `allowlist` row is the LIVE source of truth, so approvals and blocks
 *     take effect without a redeploy.
 *   - ALLOWED_EMAILS is the owner bootstrap, and the fallback when the database
 *     is unreachable.
 *
 * A blocked row denies access EVEN FOR an ALLOWED_EMAILS address. The env var
 * grants access only when there is no row at all, or when the query itself
 * failed. That ordering matters: the alternative would make the env var an
 * un-revocable back door that the admin UI cannot close.
 *
 * On a database outage we fall back to the env list -- never to "allow everyone".
 */

export interface AllowlistRow {
  email: string
  blocked: boolean
  added_at: string
  /** Derived: a matching users row means this person has signed in at least once. */
  has_signed_in: boolean
}

/**
 * A 7-day session cookie would otherwise outlive a block, so this is re-checked
 * on every request. One indexed lookup, cached in-process for 60 seconds, which
 * satisfies "blocking takes effect immediately" far more strongly than a
 * login-time-only check.
 */
const CACHE_TTL_MS = 60_000

interface CacheEntry {
  allowed: boolean
  at: number
}

const cache = new Map<string, CacheEntry>()

export function invalidateAllowlistCache(email?: string): void {
  if (email) cache.delete(normalize(email))
  else cache.clear()
}

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

export function bootstrapEmails(): string[] {
  return emailList('ALLOWED_EMAILS')
}

/** Cached allow decision for one email. */
export async function isAllowed(email: string): Promise<boolean> {
  const key = normalize(email)
  const now = Date.now()
  const hit = cache.get(key)
  // Negative results are cached too, so a rejected address cannot be used to
  // hammer the database.
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.allowed

  const allowed = await resolveAllowed(key)
  cache.set(key, { allowed, at: now })
  return allowed
}

async function resolveAllowed(email: string): Promise<boolean> {
  const bootstrap = bootstrapEmails()
  try {
    const rows = await db()<{ blocked: boolean }>`
      select blocked from allowlist where email = ${email}
    `
    const row = rows[0]
    // A row is authoritative in both directions.
    if (row) return !row.blocked
    // No row: the env bootstrap is the only remaining grant.
    return bootstrap.includes(email)
  } catch (err) {
    // Database unreachable. Fall back to the owner bootstrap so the app is not
    // wholly unusable, and log it -- this path must be visible.
    console.error('[allowlist] database unreachable, falling back to ALLOWED_EMAILS', err)
    return bootstrap.includes(email)
  }
}

/** Throws the distinct not_authorized code the login UI keys off. */
export async function assertAllowed(email: string): Promise<void> {
  if (!(await isAllowed(email))) {
    throw new ApiError(403, 'not_authorized')
  }
}

export async function listAllowlist(): Promise<AllowlistRow[]> {
  return db()<AllowlistRow>`
    select a.email,
           a.blocked,
           a.added_at,
           (u.id is not null) as has_signed_in
      from allowlist a
      left join users u on u.email = a.email
     order by a.email
  `
}

export async function addEmail(email: string): Promise<AllowlistRow> {
  const key = normalize(email)
  const rows = await db()<{ email: string; blocked: boolean; added_at: string }>`
    insert into allowlist (email) values (${key})
    on conflict (email) do nothing
    returning email, blocked, added_at
  `
  invalidateAllowlistCache(key)
  const row = rows[0]
  // `do nothing` returns no row when the address is already on the list. That is
  // the ordinary "did I already add them?" mistake, so it gets its own code --
  // a bare 409 renders as "that changed while you were looking at it", which
  // describes a lost update and tells the administrator nothing useful.
  if (!row) throw new ApiError(409, 'already_invited')
  return { ...row, has_signed_in: false }
}

export async function setBlocked(email: string, blocked: boolean): Promise<AllowlistRow> {
  const key = normalize(email)
  const rows = await db()<{ email: string; blocked: boolean; added_at: string }>`
    update allowlist set blocked = ${blocked} where email = ${key}
    returning email, blocked, added_at
  `
  // Invalidate immediately, so a block is instant in this instance and at most
  // 60 seconds old anywhere else.
  invalidateAllowlistCache(key)
  const row = rows[0]
  if (!row) throw new ApiError(404, 'not_found')
  const signedIn = await db()<{ n: number }>`
    select count(*)::int as n from users where email = ${key}
  `
  return { ...row, has_signed_in: (signedIn[0]?.n ?? 0) > 0 }
}

/** Removes the allowlist row. Does NOT delete the person's data. */
export async function removeEmail(email: string): Promise<void> {
  const key = normalize(email)
  await db()`delete from allowlist where email = ${key}`
  invalidateAllowlistCache(key)
}
