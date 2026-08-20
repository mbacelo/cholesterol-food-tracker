import { db } from './db.js'
import { ApiError } from './errors.js'
import type { AnalysisLogEntry } from '../ai/types.js'

/**
 * Cost control (tech spec §7).
 *
 * Two mechanisms, and they are not the same thing:
 *
 *   - `ai_usage` is the BUDGET: a durable per-user daily cap in Postgres, so it
 *     survives cold starts.
 *   - the in-memory limiter absorbs bursts. It resets on every cold start, so it
 *     is explicitly NOT the budget -- this app calls the model on every new entry
 *     and every description edit, and an instance-local counter cannot bound
 *     that.
 */

const DEFAULT_DAILY_CAP = 100
const BURST_WINDOW_MS = 60_000
const BURST_LIMIT = 8

export interface Budget {
  cap: number
  used: number
}

function dailyCap(): number {
  const raw = Number(process.env.AI_DAILY_CALL_LIMIT ?? DEFAULT_DAILY_CAP)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_CAP
}

const bursts = new Map<string, number[]>()

/** In-memory burst guard. Throws 429 rate_limited. */
export function assertBurst(email: string): void {
  const now = Date.now()
  const recent = (bursts.get(email) ?? []).filter((at) => now - at < BURST_WINDOW_MS)
  if (recent.length >= BURST_LIMIT) {
    bursts.set(email, recent)
    throw new ApiError(429, 'rate_limited')
  }
  recent.push(now)
  bursts.set(email, recent)
}

export function resetBursts(): void {
  bursts.clear()
}

/**
 * Read-only budget precheck, so a user over their cap gets an early, clear 429
 * instead of discovering it after a photo upload.
 */
export async function assertWithinBudget(email: string, localDay: string): Promise<Budget> {
  const rows = await db()<{ calls: number }>`
    select calls from ai_usage where email = ${email} and day = ${localDay}
  `
  const used = rows[0]?.calls ?? 0
  const cap = dailyCap()
  if (used >= cap) throw new ApiError(429, 'quota_exceeded')
  return { cap, used }
}

/**
 * Consumes one call. Called ONLY immediately before a real provider request,
 * and only after a cache miss.
 *
 * A cache hit must not consume budget -- otherwise the cheapest path burns the
 * user's quota, which is exactly backwards. That is why this is separate from
 * the precheck above rather than folded into the handler's rate-limit step.
 *
 * Increment-then-check in one statement, so concurrent calls cannot both slip
 * under the cap. A rejected call over-counts by one, which is the safe
 * direction.
 */
export async function consume(email: string, localDay: string): Promise<Budget> {
  const rows = await db()<{ calls: number }>`
    insert into ai_usage (email, day, calls) values (${email}, ${localDay}, 1)
    on conflict (email, day) do update set calls = ai_usage.calls + 1
    returning calls
  `
  const used = rows[0]?.calls ?? 1
  const cap = dailyCap()
  if (used > cap) throw new ApiError(429, 'quota_exceeded')
  return { cap, used }
}

/**
 * One line of JSON per analysis (tech spec §9), so prompt tuning can be
 * evaluated against real spend.
 *
 * Never the image bytes, and never the description TEXT: administrators read
 * logs and must never see food data (functional spec §2). The hash still lets a
 * repeated dish be correlated across lines.
 */
export function logAnalysis(entry: AnalysisLogEntry): void {
  console.log(JSON.stringify({ evt: 'analyze', ...entry }))
}
