/**
 * Environment predicates, in one place so nothing re-derives them.
 *
 * Kept separate from db.ts and debug.ts to avoid an import cycle: db.ts needs to
 * know whether local fallbacks are permitted, and debug.ts needs db.ts to seed
 * its user row.
 */

/**
 * True only when running on a developer's machine.
 *
 * `VERCEL` is set on every Vercel deployment, including preview builds, so a
 * deployed build cannot satisfy this regardless of which variables are set.
 */
export function isLocalEnvironment(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.VERCEL
}

/**
 * Debug mode (functional spec §2.1). Requires all three conditions.
 *
 * Off by default, and ignored in any deployed environment even if DEBUG_AUTH is
 * somehow set there.
 */
export function debugEnabled(): boolean {
  return process.env.DEBUG_AUTH === 'true' && isLocalEnvironment()
}

/** Grants the local debug user administrator capabilities, for testing the admin area. */
export function debugIsAdmin(): boolean {
  return debugEnabled() && process.env.DEBUG_ADMIN === 'true'
}

/** Comma-separated env list to a normalized email array. */
export function emailList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}
