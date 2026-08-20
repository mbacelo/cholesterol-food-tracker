import { createHash } from 'node:crypto'
import { db } from './db.js'

/**
 * The scoring cache, and the determinism guarantee (tech spec §7).
 *
 * The functional spec requires that the same description scored twice differ by
 * no more than one point. A cache hit returns a byte-identical result -- a ZERO
 * point difference -- and costs nothing. This covers review-screen editing and
 * everyday repeated dishes, which is most real traffic.
 */

const KEY_SCHEMA_VERSION = 'v1'

export interface CacheKeyParts {
  description: string
  isHomemade: boolean
  provider: string
  model: string
  promptVersions: string
}

/**
 * Normalizes a description before hashing.
 *
 * Case, surrounding space and internal runs of whitespace must not produce
 * different cache entries, because they do not change the dish. Nothing else is
 * stripped: punctuation and accents can be meaningful ("Ají" is not "Aji").
 */
export function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The cache key.
 *
 * Includes the provider and model as well as the prompt versions, because the
 * same text scored by a different model is a different answer, and silently
 * serving one model's score as another's would undermine the whole point. The
 * key schema version lets the shape change without a purge.
 */
export function cacheKey(parts: CacheKeyParts): string {
  const material = [
    KEY_SCHEMA_VERSION,
    parts.provider,
    parts.model,
    parts.promptVersions,
    String(parts.isHomemade),
    normalizeDescription(parts.description),
  ].join('|')
  return createHash('sha256').update(material).digest('hex')
}

/** A short, non-reversible handle for logs. Never log the description itself. */
export function descriptionHash(description: string): string {
  return createHash('sha256').update(normalizeDescription(description)).digest('hex').slice(0, 12)
}

export async function get(hash: string): Promise<unknown | null> {
  const rows = await db()<{ result: unknown }>`
    select result from score_cache where hash = ${hash}
  `
  return rows[0]?.result ?? null
}

/**
 * Stores a result. First write wins.
 *
 * `do nothing` rather than `do update`: the first stored answer for a key is the
 * canonical one, which is precisely what makes a repeat a zero-point difference
 * rather than a small one.
 */
export async function set(hash: string, result: unknown): Promise<void> {
  await db()`
    insert into score_cache (hash, result) values (${hash}, ${JSON.stringify(result)}::jsonb)
    on conflict (hash) do nothing
  `
}

/** Evicts one row. Used when a stored result no longer validates. */
export async function drop(hash: string): Promise<void> {
  await db()`delete from score_cache where hash = ${hash}`
}
