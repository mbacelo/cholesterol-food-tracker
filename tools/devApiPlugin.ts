import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import type { ApiHandler, ApiRequest, ApiResponse } from '../lib/server/http.js'

/**
 * Local development bridge for the serverless handlers (tech spec §2).
 *
 * `npm run dev` must serve the UI *and* /api together, running the real handler
 * modules in-process so there is no second CLI and no separate code path to
 * drift out of sync with production. This plugin loads each handler through
 * Vite's SSR pipeline and shims the small request/response contract that the
 * Vercel Node runtime provides.
 *
 * -- The two lists --------------------------------------------------------
 * SERVER_ENV_KEYS and API_ENDPOINTS below must be updated in the SAME COMMIT
 * that adds an endpoint or a server env var. Getting that wrong is the
 * "404 locally but fine in production" risk in tech spec §10, so both lists
 * fail loudly rather than silently: a request to an unlisted /api path returns
 * 501 naming this file, and an unlisted non-VITE_ key in .env.local warns at
 * startup instead of silently arriving at the handler as undefined.
 */

/** Server-only env vars the handlers read. Never exposed to the browser. */
export const SERVER_ENV_KEYS = [
  'AI_PROVIDER',
  'AI_MODEL',
  'AI_EFFORT',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'GOOGLE_CLIENT_ID',
  'SESSION_SECRET',
  'ALLOWED_EMAILS',
  'ADMIN_EMAILS',
  'DEBUG_AUTH',
  'DEBUG_ADMIN',
  'AI_DAILY_CALL_LIMIT',
  'RUN_AI_FIXTURES',
] as const

/** Every endpoint under api/. Each name maps to the module `api/<name>.ts`. */
export const API_ENDPOINTS = [
  'session',
  'analyze',
  'entries',
  'settings',
  'summary',
  'export',
  'admin/ping',
  'admin/allowlist',
  'admin/prompts',
  'admin/users',
] as const

/**
 * Vercel hard-caps a request/response payload at 4.5 MB (413
 * FUNCTION_PAYLOAD_TOO_LARGE), so tech spec §6's 5 MB body-parser limit is not
 * reachable in production. 4 MB keeps dev and prod refusing the same requests.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024

const JSON_CONTENT_TYPES = ['application/json', 'application/csp-report']

/** Vite injects these into the loadEnv result; they are not handler env vars. */
const VITE_INTRINSIC_KEYS = ['NODE_ENV', 'BASE_URL', 'MODE', 'DEV', 'PROD', 'SSR']

// The handler contract lives in lib/server/http.ts: production code must not
// depend on a dev-only module, and there must be exactly one definition for the
// runtime to satisfy and for this plugin to shim.

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const name = part.slice(0, eq).trim()
    if (!name) continue
    const value = part.slice(eq + 1).trim()
    try {
      out[name] = decodeURIComponent(value)
    } catch {
      out[name] = value
    }
  }
  return out
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        settled = true
        rej(Object.assign(new Error('request body too large'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      res(Buffer.concat(chunks))
    })
    req.on('error', (err) => {
      if (settled) return
      settled = true
      rej(err)
    })
  })
}

/** Mirrors how Vercel populates req.body: parsed for JSON/form/text, raw Buffer otherwise. */
function decodeBody(raw: Buffer, contentType: string | undefined): unknown {
  if (raw.length === 0) return undefined
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
  if (JSON_CONTENT_TYPES.includes(type)) return JSON.parse(raw.toString('utf8'))
  if (type === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(raw.toString('utf8')))
  }
  if (type.startsWith('text/')) return raw.toString('utf8')
  return raw
}

/**
 * Installs `body` as a LAZY, CACHED getter that throws on malformed input.
 *
 * This mirrors the Vercel runtime exactly, and the fidelity matters: there,
 * parsing happens when the handler touches req.body, so a malformed JSON body
 * throws a SyntaxError INSIDE the handler's try block and handleError turns it
 * into a 400. Parsing eagerly out here instead would surface the same request as
 * a 500 locally and a 400 in production -- a behaviour difference in exactly the
 * layer whose job is to not have one.
 */
function defineLazyBody(req: IncomingMessage, raw: Buffer): void {
  let parsed: unknown
  let thrown: unknown
  let done = false
  Object.defineProperty(req, 'body', {
    configurable: true,
    enumerable: true,
    get() {
      if (!done) {
        done = true
        try {
          parsed = decodeBody(raw, req.headers['content-type'])
        } catch (err) {
          thrown = err
        }
      }
      if (thrown) throw thrown
      return parsed
    },
  })
}

function decorate(res: ServerResponse): ApiResponse {
  const out = res as ApiResponse
  out.status = (code: number) => {
    out.statusCode = code
    return out
  }
  out.json = (payload: unknown) => {
    if (!out.getHeader('Content-Type')) {
      out.setHeader('Content-Type', 'application/json; charset=utf-8')
    }
    out.end(JSON.stringify(payload))
  }
  out.send = (payload: string | Buffer) => {
    out.end(payload)
  }
  out.redirect = (statusOrUrl: number | string, url?: string) => {
    const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302
    const target = typeof statusOrUrl === 'number' ? url : statusOrUrl
    if (!target) throw new Error('res.redirect() called without a target URL')
    out.statusCode = status
    out.setHeader('Location', target)
    out.end()
  }
  return out
}

export function devApiPlugin(): Plugin {
  return {
    name: 'food-tracker:dev-api',
    apply: 'serve',

    config(_config, { mode }) {
      // An empty prefix makes loadEnv return the whole ambient process.env as
      // well as the .env files, so snapshot the ambient keys first: the
      // difference is what the file actually declares, and only those are worth
      // warning about.
      const ambient = new Set(Object.keys(process.env))

      // Copy ONLY the declared keys into process.env. Anything absent from the
      // list never reaches a handler, which is what makes the list load-bearing.
      const env = loadEnv(mode, process.cwd(), '')
      for (const key of SERVER_ENV_KEYS) {
        const value = env[key]
        if (value !== undefined && value !== '') process.env[key] = value
      }

      const undeclared = Object.keys(env).filter(
        (key) =>
          !ambient.has(key) &&
          !key.startsWith('VITE_') &&
          !(SERVER_ENV_KEYS as readonly string[]).includes(key) &&
          !VITE_INTRINSIC_KEYS.includes(key),
      )
      if (undeclared.length > 0) {
        console.warn(
          `\n[dev-api] .env.local defines ${undeclared.join(', ')}, which is not in ` +
            `SERVER_ENV_KEYS (tools/devApiPlugin.ts).\n` +
            `          Handlers will NOT see it. Add it to that list, or prefix it with ` +
            `VITE_ if the browser is meant to read it.\n`,
        )
      }
      return undefined
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? '/'
        if (rawUrl !== '/api' && !rawUrl.startsWith('/api/')) return next()

        const url = new URL(rawUrl, 'http://localhost')
        const name = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '')
        const response = decorate(res)

        if (!(API_ENDPOINTS as readonly string[]).includes(name)) {
          // Loud on purpose. A silent 404 here looks like a client bug and would
          // work in production, which is exactly the drift this list prevents.
          const message =
            `/api/${name} is not in API_ENDPOINTS (tools/devApiPlugin.ts). ` +
            `Add it in the same commit as api/${name}.ts.`
          console.error(`[dev-api] ${message}`)
          response.status(501).json({ error: 'endpoint_not_registered', message })
          return
        }

        const modulePath = `/api/${name}.ts`
        if (!existsSync(resolve(process.cwd(), `api/${name}.ts`))) {
          const message = `${modulePath} is listed in API_ENDPOINTS but the file does not exist.`
          console.error(`[dev-api] ${message}`)
          response.status(501).json({ error: 'handler_missing', message })
          return
        }

        try {
          const raw = await readBody(req)
          const apiReq = req as ApiRequest
          defineLazyBody(req, raw)
          apiReq.cookies = parseCookies(req.headers.cookie)
          apiReq.query = Object.fromEntries(
            [...new Set(url.searchParams.keys())].map((key) => {
              const all = url.searchParams.getAll(key)
              return [key, all.length > 1 ? all : all[0]!]
            }),
          )

          const mod = (await server.ssrLoadModule(modulePath)) as { default?: ApiHandler }
          if (typeof mod.default !== 'function') {
            throw new Error(`${modulePath} must export a default request handler`)
          }
          await mod.default(apiReq, response)
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode ?? 500
          // Log the real error server-side and return a generic message, so provider
          // errors, keys and SQL never reach the client (tech spec §2).
          if (status === 413) {
            console.warn('[dev-api] rejected an oversized request body')
          } else {
            server.ssrFixStacktrace?.(err as Error)
            console.error(`[dev-api] ${modulePath} failed:`, err)
          }
          if (res.headersSent) {
            res.end()
          } else {
            response
              .status(status)
              .json({ error: status === 413 ? 'payload_too_large' : 'server_error' })
          }
        }
      })
    },
  }
}
