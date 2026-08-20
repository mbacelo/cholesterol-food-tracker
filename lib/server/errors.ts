import { ZodError } from 'zod'
import type { ApiResponse } from './http.js'

/**
 * One exit path for every failure (tech spec §2).
 *
 * Every `catch` in api/ calls handleError, which logs the real error
 * server-side and returns a generic, machine-readable code. That is what keeps
 * provider errors, API keys, connection strings and SQL text out of every
 * response body.
 */

export type ErrorCode =
  /** Malformed or invalid input. */
  | 'bad_request'
  /** No session, or an expired one. The client should sign in again. */
  | 'unauthorized'
  /** Signed in with Google, but not on the allowlist. A distinct code so the UI
   *  can say "not authorized" rather than showing a generic failure (§5). */
  | 'not_authorized'
  /** Authenticated, but not permitted. Normal for a non-admin hitting admin/*. */
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'conflict'
  /** In-memory burst limiter tripped. */
  | 'rate_limited'
  /** Durable per-user daily AI budget exhausted. */
  | 'quota_exceeded'
  /** Revert requested with no previous prompt version stored. */
  | 'nothing_to_revert'
  /** The model could not find food in the image; drives the §6.1 fallback. */
  | 'no_food_detected'
  /** The model failed or returned invalid output after the one retry. */
  | 'ai_unavailable'
  /** A required environment variable is missing. Fails loud, never open. */
  | 'misconfigured'
  | 'internal_error'

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  /** Whether `message` is safe to show the user. Default: it is not. */
  readonly expose: boolean

  // Fields are declared and assigned explicitly rather than as constructor
  // parameter properties, because `erasableSyntaxOnly` forbids the shorthand --
  // it is syntax that cannot be erased by a type-stripping runtime.
  constructor(status: number, code: ErrorCode, message?: string, expose = false) {
    super(message ?? code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.expose = expose
  }
}

/**
 * A missing or malformed environment variable.
 *
 * Always a 500, never a permissive default: a configuration gap must never
 * widen who can sign in or what gets stored.
 */
export class ConfigError extends ApiError {
  constructor(message: string) {
    super(500, 'misconfigured', message, false)
    this.name = 'ConfigError'
  }
}

export function fail(
  res: ApiResponse,
  status: number,
  code: ErrorCode,
  extra?: Record<string, unknown>,
): void {
  res.status(status).json({ error: code, ...extra })
}

/** Reads a required env var, or throws a ConfigError naming it. */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new ConfigError(`${name} is not set`)
  }
  return value
}

export function handleError(res: ApiResponse, err: unknown, context: string): void {
  if (res.headersSent) {
    // A handler already responded and then threw. Nothing safe to add.
    console.error(`[${context}] threw after responding:`, err)
    res.end()
    return
  }

  if (err instanceof ZodError) {
    // Field-level detail is safe and useful: it describes the caller's own input.
    return fail(res, 400, 'bad_request', { fields: err.flatten().fieldErrors })
  }

  if (err instanceof SyntaxError) {
    // A malformed JSON body. Vercel's req.body getter throws this too, so dev and
    // production fail identically.
    return fail(res, 400, 'bad_request')
  }

  if (err instanceof ApiError) {
    if (err.status >= 500) console.error(`[${context}]`, err)
    return fail(res, err.status, err.code, err.expose ? { message: err.message } : undefined)
  }

  console.error(`[${context}]`, err)
  return fail(res, 500, 'internal_error')
}

/** Rejects an unsupported method with the Allow header set. */
export function assertMethod(res: ApiResponse, actual: string | undefined, allowed: string[]): void {
  if (actual && allowed.includes(actual)) return
  res.setHeader('Allow', allowed.join(', '))
  throw new ApiError(405, 'method_not_allowed')
}
