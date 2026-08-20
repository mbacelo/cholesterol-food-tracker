import { emailList } from './env.js'
import { debugIsAdmin } from './env.js'

/**
 * Who is an administrator (tech spec §5).
 *
 * Administrators are defined by ADMIN_EMAILS and NEVER authoritatively in the
 * database. The admin UI writes to `allowlist`; keeping the role out of every
 * table that UI can write means the admin screen cannot grant admin to anyone,
 * including itself. `users.is_admin` exists only as a denormalized rendering
 * hint and is never consulted for authorization.
 *
 * Do not add an authoritative role column for a future feature without
 * revisiting this.
 *
 * Kept in its own module so users.ts can write the rendering hint without
 * importing session.ts, which would be a cycle.
 */
export function isAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase()
  if (debugIsAdmin() && normalized === DEBUG_EMAIL) return true
  return emailList('ADMIN_EMAILS').includes(normalized)
}

/** The fixed local debug identity (functional spec §2.1). */
export const DEBUG_EMAIL = 'debug@localhost'
export const DEBUG_GOOGLE_SUB = 'debug-local-user'
