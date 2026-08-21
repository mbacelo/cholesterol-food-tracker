import { db, oneOr404 } from './db.js'
import { isAdminEmail } from './admins.js'
import type { GoogleIdentity } from './googleAuth.js'

/**
 * User provisioning and settings.
 *
 * A note on numerics: the Neon driver returns Postgres `numeric` as a STRING.
 * `daily_average_target` is numeric(3,1), so every read casts it to ::float.
 * Without that cast a string silently propagates into a chart axis or a
 * comparison, which is a genuinely nasty bug to trace.
 */

export interface UserRow {
  id: string
  email: string
  is_admin: boolean
  daily_average_target: number
  min_entries_for_valid_day: number
}

export interface Settings {
  daily_average_target: number
  min_entries_for_valid_day: number
}

export const DEFAULT_SETTINGS: Settings = {
  daily_average_target: 1,
  min_entries_for_valid_day: 2,
}

/**
 * Creates the user on first login, or refreshes their email.
 *
 * Keyed on `google_sub`, not email: the Google account is the stable identity
 * and an email can change underneath it.
 *
 * `is_admin` is WRITTEN here from ADMIN_EMAILS and is never read for
 * authorization -- requireAdmin() always consults the env var. The column exists
 * only as a rendering hint (tech spec §5). Keeping the authoritative role out of
 * every table the admin UI can write is what makes it impossible for the admin
 * screen to grant admin to anyone, including itself.
 */
export async function provisionUser(identity: GoogleIdentity): Promise<UserRow> {
  const rows = await db()<UserRow>`
    insert into users (google_sub, email, is_admin)
    values (${identity.sub}, ${identity.email}, ${isAdminEmail(identity.email)})
    on conflict (google_sub) do update
      set email = excluded.email,
          is_admin = excluded.is_admin
    returning id,
              email,
              is_admin,
              daily_average_target::float as daily_average_target,
              min_entries_for_valid_day
  `
  return oneOr404(rows)
}

export async function getSettings(userId: string): Promise<Settings> {
  const rows = await db()<Settings>`
    select daily_average_target::float as daily_average_target,
           min_entries_for_valid_day
      from users
     where id = ${userId}
  `
  return oneOr404(rows)
}

/**
 * Updates whichever settings were supplied.
 *
 * Written as a single statement with coalesce rather than a built-up string, so
 * there is one SQL shape to review and no dynamic fragment assembly.
 */
export async function updateSettings(userId: string, patch: Partial<Settings>): Promise<Settings> {
  const target = patch.daily_average_target ?? null
  const minEntries = patch.min_entries_for_valid_day ?? null
  const rows = await db()<Settings>`
    update users
       set daily_average_target      = coalesce(${target}::numeric(3,1), daily_average_target),
           min_entries_for_valid_day = coalesce(${minEntries}::int, min_entries_for_valid_day)
     where id = ${userId}
    returning daily_average_target::float as daily_average_target,
              min_entries_for_valid_day
  `
  return oneOr404(rows)
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await db()<UserRow>`
    select id,
           email,
           is_admin,
           daily_average_target::float as daily_average_target,
           min_entries_for_valid_day
      from users
     where email = ${email.trim().toLowerCase()}
  `
  return rows[0] ?? null
}

/**
 * Deletes a user and everything keyed to them. `food_entries` cascades via its
 * foreign key.
 *
 * Deliberately does not name food_entries: this is called from the admin path,
 * and the admin surface's only contact with food data is a count and this
 * cascade.
 *
 * `ai_usage` does NOT cascade -- it is keyed by email rather than user_id, so it
 * has no foreign key to hang a cascade on -- and it therefore has to be deleted
 * explicitly. Without this the address of a deleted person survives a deletion
 * the administrator confirmed as total.
 *
 * Usage rows go FIRST. The HTTP driver has no interactive transaction, so if the
 * second statement fails the survivor should be the harmless one: a stale budget
 * counter resets by itself at midnight, whereas a lingering email address is the
 * bug this ordering exists to prevent.
 */
export async function deleteUserById(userId: string, email: string): Promise<void> {
  await db()`delete from ai_usage where email = ${email.trim().toLowerCase()}`
  await db()`delete from users where id = ${userId}`
}
