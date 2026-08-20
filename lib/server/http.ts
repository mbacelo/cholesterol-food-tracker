import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * The request/response contract every handler under api/ is written against.
 *
 * This is the subset of the Vercel Node runtime's helpers we actually use. It is
 * declared here rather than imported from @vercel/node so that production code
 * does not depend on a dev-only package, and so the dev API plugin has exactly
 * one contract to shim (tools/devApiPlugin.ts). In a deployed function these
 * members are provided by the runtime; locally the plugin adds them.
 */

export interface ApiRequest extends IncomingMessage {
  /** Parsed query string. A repeated key arrives as an array. */
  query: Record<string, string | string[]>
  cookies: Record<string, string>
  /**
   * Parsed for JSON, form-encoded and text bodies; a raw Buffer otherwise;
   * undefined when the body is empty.
   */
  body: unknown
}

export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse
  json(payload: unknown): void
  send(payload: string | Buffer): void
  redirect(statusOrUrl: number | string, url?: string): void
}

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => void | Promise<void>

/** Reads a single-valued query parameter, rejecting the repeated-key case. */
export function queryParam(req: ApiRequest, name: string): string | undefined {
  const value = req.query[name]
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}
