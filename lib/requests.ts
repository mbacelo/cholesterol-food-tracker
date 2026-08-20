import { z } from 'zod'
import { MAX_TZ_OFFSET_MINUTES, MIN_TZ_OFFSET_MINUTES, isValidDateString } from './dates.js'

/**
 * Request schemas, shared by the handlers that validate them.
 *
 * Every object is `.strict()`. That is a deliberate choice about the rule "the
 * score is never accepted from the client": a body carrying `score`, `rationale`
 * or `user_id` is REJECTED with a 400 rather than silently ignored. Rejecting is
 * strictly safer -- silently dropping a field means a client bug that tries to
 * set a score looks like it worked -- and it still satisfies the requirement that
 * no code path accepts a score from a request.
 *
 * (lib/ai/schemas.ts is the separate, unrelated set for validating MODEL output.)
 */

export const zTzOffset = z
  .number()
  .int()
  .min(MIN_TZ_OFFSET_MINUTES)
  .max(MAX_TZ_OFFSET_MINUTES)
  .describe('Minutes EAST of UTC. UTC-3 is -180. See lib/dates.ts.')

export const zLocalDate = z
  .string()
  .refine(isValidDateString, 'must be a real calendar date formatted YYYY-MM-DD')

/** Functional spec §3.1: the description is capped at 200 characters. */
export const zDescription = z.string().trim().min(1).max(200)

export const zUuid = z.string().uuid()

/**
 * A deliberately permissive email check.
 *
 * Zod's `.email()` rejects `debug@localhost` for having no TLD, which would make
 * the admin screens unusable in debug mode -- and strict RFC validation buys
 * nothing here: the only addresses that ever authenticate come from Google
 * already verified, and an administrator typing a malformed address onto the
 * allowlist simply never matches a login.
 */
export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .regex(/^[^\s@]+@[^\s@]+$/, 'must look like an email address')

/**
 * An image on the wire.
 *
 * Base64 inside JSON rather than multipart: the serverless runtime parses JSON
 * for free and parses no multipart, a ~400 KB JPEG becomes ~547 KB of base64,
 * and one Zod schema can then validate the whole body. The cap here is the
 * base64 length that corresponds to roughly the 3.5 MB decoded limit in tech
 * spec §6; the handler additionally checks the DECODED size and the magic bytes,
 * because a declared content type is just a claim.
 */
export const zImage = z
  .object({
    content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    data_base64: z
      .string()
      .min(1)
      .max(4_800_000)
      // A data: URL prefix is a common client mistake and would corrupt the
      // decode; reject it explicitly rather than storing a broken object.
      .refine((value) => !value.includes('base64,'), 'send raw base64, not a data: URL'),
  })
  .strict()

export const zAnalyze = z
  .object({
    description: zDescription.optional(),
    is_homemade: z.boolean(),
    image: zImage.optional(),
    // Nothing is dated by this endpoint; the offset is used only so the durable
    // daily budget resets at the caller's own midnight.
    tz_offset_minutes: zTzOffset.optional(),
  })
  .strict()
  .refine(
    (body) => body.description !== undefined || body.image !== undefined,
    'provide a description, an image, or both',
  )

export const zCreateEntry = z
  .object({
    entry_date: zLocalDate,
    tz_offset_minutes: zTzOffset,
    description: zDescription,
    is_homemade: z.boolean(),
    // Store path is JPEG only, so the R2 key can honestly be .jpg
    // (utils/image.ts always re-encodes to JPEG anyway).
    image: zImage.extend({ content_type: z.literal('image/jpeg') }).optional(),
  })
  .strict()

export const zPatchEntry = z
  .object({
    tz_offset_minutes: zTzOffset,
    entry_date: zLocalDate.optional(),
    description: zDescription.optional(),
    is_homemade: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.entry_date !== undefined ||
      body.description !== undefined ||
      body.is_homemade !== undefined,
    'change at least one of entry_date, description or is_homemade',
  )

/** Functional spec §3.3: -2.0 to +5.0 in steps of 0.5, and 1 to 5. */
export const zSettingsPatch = z
  .object({
    daily_average_target: z.number().min(-2).max(5).multipleOf(0.5).optional(),
    min_entries_for_valid_day: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.daily_average_target !== undefined || body.min_entries_for_valid_day !== undefined,
    'change at least one setting',
  )

export const zSession = z
  .object({
    id_token: z.string().min(1),
  })
  .strict()

export const zPeriod = z.union([z.literal(7), z.literal(30), z.literal(90)])

export type AnalyzeBody = z.infer<typeof zAnalyze>
export type CreateEntryBody = z.infer<typeof zCreateEntry>
export type PatchEntryBody = z.infer<typeof zPatchEntry>
export type SettingsPatchBody = z.infer<typeof zSettingsPatch>
