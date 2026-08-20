import { db, oneOr404 } from './db.js'
import { ApiError, ConfigError } from './errors.js'
import { PROMPT_KEYS, type PromptKey } from '../ai/prompts/defaults.js'

/**
 * The prompts table (tech spec §7).
 *
 * Both prompts are loaded at request time, never from code, so an
 * administrator's edit takes effect immediately and applies to future analyses
 * only. Saving copies the old body into `previous_body` and bumps `version`;
 * Revert swaps them back. That one column is the whole safety net for a bad
 * prompt edit.
 */

export interface PromptRow {
  key: PromptKey
  body: string
  previous_body: string | null
  version: number
  updated_at: string
  updated_by: string | null
}

export async function getPrompts(): Promise<Record<PromptKey, PromptRow>> {
  // One round trip: each statement is an HTTP request on the Neon driver.
  const rows = await db()<PromptRow>`
    select key, body, previous_body, version, updated_at, updated_by
      from prompts
     where key = any(${[...PROMPT_KEYS]})
  `
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const out = {} as Record<PromptKey, PromptRow>
  for (const key of PROMPT_KEYS) {
    const row = byKey.get(key)
    // A missing row is a configuration error, never a hard-coded fallback
    // prompt: falling back in code would make "prompts are editable content"
    // (functional spec §3.4) a lie, and would silently score entries with text
    // the administrator cannot see or edit.
    if (!row) {
      throw new ConfigError(`prompt "${key}" is missing; run db/migrations/002_seed_prompts.sql`)
    }
    out[key] = row
  }
  return out
}

/**
 * The prompt versions, for the cache key.
 *
 * Including them means an administrator's edit invalidates the cache naturally,
 * while existing entries keep their stored scores -- exactly the
 * non-retroactivity rule.
 */
export function promptVersionsTag(prompts: Record<PromptKey, PromptRow>): string {
  return PROMPT_KEYS.map((key) => `${key}=${prompts[key].version}`).join('|')
}

export async function savePrompt(
  key: PromptKey,
  body: string,
  updatedBy: string,
): Promise<PromptRow> {
  // `body <> ${body}` guards against a no-op save burning the one revert slot:
  // saving unchanged text would otherwise overwrite previous_body with an
  // identical copy and destroy the only way back.
  const rows = await db()<PromptRow>`
    update prompts
       set previous_body = body,
           body = ${body},
           version = version + 1,
           updated_at = now(),
           updated_by = ${updatedBy}
     where key = ${key} and body <> ${body}
    returning key, body, previous_body, version, updated_at, updated_by
  `
  const row = rows[0]
  if (row) return row

  const unchanged = await db()<PromptRow>`
    select key, body, previous_body, version, updated_at, updated_by
      from prompts where key = ${key}
  `
  return oneOr404(unchanged)
}

/** Swaps body and previous_body, so a revert is itself revertible. */
export async function revertPrompt(key: PromptKey, updatedBy: string): Promise<PromptRow> {
  const rows = await db()<PromptRow>`
    update prompts
       set body = previous_body,
           previous_body = body,
           version = version + 1,
           updated_at = now(),
           updated_by = ${updatedBy}
     where key = ${key} and previous_body is not null
    returning key, body, previous_body, version, updated_at, updated_by
  `
  const row = rows[0]
  if (!row) throw new ApiError(409, 'nothing_to_revert')
  return row
}

export { PROMPT_KEYS }
export type { PromptKey }
