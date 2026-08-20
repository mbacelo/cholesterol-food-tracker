import { DEBUG_EMAIL, DEBUG_GOOGLE_SUB } from './admins.js'
import { db, oneOr404 } from './db.js'
import { debugEnabled, debugIsAdmin } from './env.js'
import { ApiError } from './errors.js'
import type { SessionUser } from './session.js'

/**
 * Local debug mode (functional spec §2.1).
 *
 * Skips authentication and starts a session as a fixed local debug user: no
 * login screen, no allowlist check. Everything else is unchanged -- the debug
 * user is an ordinary user, subject to every rule in the spec.
 *
 * The gate lives in env.ts and requires all three of DEBUG_AUTH=true,
 * NODE_ENV!=production and no VERCEL variable, so a deployed build cannot
 * satisfy it regardless of what is configured.
 */

let cachedUser: SessionUser | undefined

/**
 * Returns the debug user, seeding a REAL `users` row on first use.
 *
 * A real row matters: it means every constraint, cascade and foreign key applies
 * to debug sessions exactly as it would to a signed-in person, so local testing
 * exercises the same rules production does. A synthetic in-memory user would let
 * bugs hide until first deploy.
 */
export async function getDebugUser(): Promise<SessionUser> {
  if (!debugEnabled()) {
    // Reaching here means a caller checked the gate incorrectly. Fail loudly
    // rather than handing out a session.
    throw new ApiError(500, 'internal_error', 'getDebugUser called while debug mode is off')
  }
  if (cachedUser) return cachedUser

  const rows = await db()<{ id: string; email: string }>`
    insert into users (google_sub, email, is_admin)
    values (${DEBUG_GOOGLE_SUB}, ${DEBUG_EMAIL}, ${debugIsAdmin()})
    on conflict (google_sub) do update set is_admin = excluded.is_admin
    returning id, email
  `
  const row = oneOr404(rows)

  cachedUser = {
    id: row.id,
    email: row.email,
    isAdmin: debugIsAdmin(),
    isDebug: true,
  }
  return cachedUser
}

/** Resets the memoized debug user. Tests only. */
export function resetDebugUser(): void {
  cachedUser = undefined
}
