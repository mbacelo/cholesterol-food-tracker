import { tzOffsetMinutes } from './localDate'

/**
 * Every request the browser makes goes through here.
 *
 * Three jobs: attach the session cookie, attach tz_offset_minutes so no screen
 * can forget it, and map server error CODES to copy. The server never returns a
 * human message for a failure, so the mapping lives on this side -- that is what
 * keeps provider errors and SQL out of the UI.
 */

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_authorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'conflict'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'nothing_to_revert'
  | 'no_food_detected'
  | 'ai_unavailable'
  | 'misconfigured'
  | 'internal_error'
  | 'offline'

export const ERROR_COPY: Record<ApiErrorCode, string> = {
  bad_request: 'Something about that request was not valid.',
  unauthorized: 'Your session expired. Sign in again.',
  not_authorized: 'This Google account is not on the invitation list.',
  forbidden: 'You do not have access to that.',
  not_found: 'That is no longer there.',
  method_not_allowed: 'Something about that request was not valid.',
  payload_too_large: 'That photo is too large even after compression. Try again.',
  conflict: 'That changed while you were looking at it. Reload and try again.',
  rate_limited: 'That is a lot of requests at once. Wait a moment and retry.',
  quota_exceeded: 'You have reached today’s analysis limit. Try again tomorrow.',
  nothing_to_revert: 'There is no previous version to restore.',
  no_food_detected: 'I could not identify food in that photo.',
  ai_unavailable: 'Scoring is unavailable right now. Try again in a moment.',
  misconfigured: 'The app is not fully configured. Check the server settings.',
  internal_error: 'Something went wrong on our side.',
  offline: 'You are offline. Logging needs a connection.',
}

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly fields: Record<string, string[]> | undefined

  constructor(status: number, code: ApiErrorCode, fields?: Record<string, string[]>) {
    super(ERROR_COPY[code] ?? ERROR_COPY.internal_error)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

/** Notified on a 401 so the session context can drop to "signed out". */
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | undefined
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler
}

/** Endpoints that need the caller's timezone to resolve "today". */
const NEEDS_TZ = ['/api/entries', '/api/summary', '/api/export', '/api/analyze']

export interface ApiOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** Set false for the admin probe, where a 401/403 is an ordinary answer. */
  reportUnauthorized?: boolean
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(0, 'offline')
  }

  const method = options.method ?? 'GET'
  let url = path
  let body: string | undefined

  const needsTz = NEEDS_TZ.some((prefix) => path.startsWith(prefix))

  if (options.body !== undefined) {
    const payload =
      needsTz && typeof options.body === 'object' && options.body !== null
        ? { ...(options.body as Record<string, unknown>), tz_offset_minutes: tzOffsetMinutes() }
        : options.body
    body = JSON.stringify(payload)
  } else if (needsTz && method === 'GET') {
    // GETs carry it in the query string instead.
    const separator = url.includes('?') ? '&' : '?'
    url = `${url}${separator}tz_offset_minutes=${tzOffsetMinutes()}`
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, 'offline')
  }

  if (response.status === 401 && options.reportUnauthorized !== false) {
    onUnauthorized?.()
  }

  if (!response.ok) {
    let code: ApiErrorCode = 'internal_error'
    let fields: Record<string, string[]> | undefined
    try {
      const parsed = (await response.json()) as { error?: string; fields?: Record<string, string[]> }
      if (parsed.error && parsed.error in ERROR_COPY) code = parsed.error as ApiErrorCode
      fields = parsed.fields
    } catch {
      // A non-JSON error body. Keep the generic code.
    }
    throw new ApiError(response.status, code, fields)
  }

  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text.length > 0 ? JSON.parse(text) : undefined) as T
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return ERROR_COPY.internal_error
}
