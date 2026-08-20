import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isAllowed, invalidateAllowlistCache } from './allowlist'
import { isAdminEmail } from './admins'
import { db, resetDb } from './db'
import { debugEnabled, debugIsAdmin, isLocalEnvironment } from './env'
import { ConfigError } from './errors'
import { verifyGoogleIdToken } from './googleAuth'
import {
  SESSION_COOKIE_NAME,
  clearedCookie,
  requireUser,
  readUser,
  sessionCookie,
  signSession,
} from './session'
import type { ApiRequest, ApiResponse } from './http'

const SECRET = 'a'.repeat(48)

/** Minimal stand-ins for the handler contract. */
function fakeReq(cookies: Record<string, string> = {}): ApiRequest {
  return { cookies, query: {}, body: undefined } as unknown as ApiRequest
}

function fakeRes(): ApiResponse & { headers: Record<string, string> } {
  const headers: Record<string, string> = {}
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value
      return this
    },
  } as unknown as ApiResponse & { headers: Record<string, string> }
}

beforeAll(async () => {
  delete process.env.DATABASE_URL
  delete process.env.VERCEL
  process.env.NODE_ENV = 'test'
  resetDb()
  // Ensure the schema exists (the local fallback applies migrations on open).
  await db()`select 1`
}, 60_000)

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET
  delete process.env.VERCEL
  delete process.env.DEBUG_AUTH
  delete process.env.DEBUG_ADMIN
  process.env.ALLOWED_EMAILS = ''
  process.env.ADMIN_EMAILS = ''
  invalidateAllowlistCache()
})

afterEach(async () => {
  await db()`delete from allowlist`
})

describe('debug mode requires all three conditions (functional spec §2.1)', () => {
  it('is off by default', () => {
    expect(debugEnabled()).toBe(false)
  })

  it('needs the flag explicitly set to the string "true"', () => {
    process.env.DEBUG_AUTH = 'true'
    expect(debugEnabled()).toBe(true)
    process.env.DEBUG_AUTH = '1'
    expect(debugEnabled()).toBe(false)
    process.env.DEBUG_AUTH = 'TRUE'
    expect(debugEnabled()).toBe(false)
  })

  it('cannot be enabled in a deployed environment, whatever is set', () => {
    // This is the acceptance criterion: VERCEL is present on every deployment,
    // so a deployed build cannot satisfy the gate.
    process.env.DEBUG_AUTH = 'true'
    process.env.VERCEL = '1'
    expect(isLocalEnvironment()).toBe(false)
    expect(debugEnabled()).toBe(false)
    expect(debugIsAdmin()).toBe(false)
  })

  it('cannot be enabled in a production build', () => {
    process.env.DEBUG_AUTH = 'true'
    process.env.NODE_ENV = 'production'
    expect(debugEnabled()).toBe(false)
    process.env.NODE_ENV = 'test'
  })

  it('grants admin only when both debug flags are on', () => {
    process.env.DEBUG_AUTH = 'true'
    expect(debugIsAdmin()).toBe(false)
    process.env.DEBUG_ADMIN = 'true'
    expect(debugIsAdmin()).toBe(true)
  })
})

describe('administrators come from ADMIN_EMAILS only (tech spec §5)', () => {
  it('reads the env var, case- and space-insensitively', () => {
    process.env.ADMIN_EMAILS = ' Owner@Example.com , second@example.com '
    expect(isAdminEmail('owner@example.com')).toBe(true)
    expect(isAdminEmail('OWNER@EXAMPLE.COM')).toBe(true)
    expect(isAdminEmail('second@example.com')).toBe(true)
    expect(isAdminEmail('nobody@example.com')).toBe(false)
  })

  it('is nobody when the variable is empty', () => {
    process.env.ADMIN_EMAILS = ''
    expect(isAdminEmail('owner@example.com')).toBe(false)
  })

  it('ignores users.is_admin entirely', async () => {
    // The column is a rendering hint. Writing true to it must not confer admin,
    // because the admin UI can write tables and must not be able to escalate.
    process.env.ADMIN_EMAILS = ''
    await db()`
      insert into users (google_sub, email, is_admin)
      values ('hint-sub', 'hint@example.com', true)
      on conflict (google_sub) do update set is_admin = true
    `
    expect(isAdminEmail('hint@example.com')).toBe(false)
  })
})

describe('allowlist precedence: all four env x database quadrants', () => {
  const email = 'person@example.com'

  it('no row, not in env: denied', async () => {
    expect(await isAllowed(email)).toBe(false)
  })

  it('no row, in env: allowed (the owner bootstrap)', async () => {
    process.env.ALLOWED_EMAILS = email
    expect(await isAllowed(email)).toBe(true)
  })

  it('unblocked row, not in env: allowed (the live source of truth)', async () => {
    await db()`insert into allowlist (email) values (${email})`
    expect(await isAllowed(email)).toBe(true)
  })

  it('BLOCKED row, in env: DENIED -- the database wins', async () => {
    // The important quadrant. If the env var won here it would be an
    // un-revocable back door that the admin UI could not close.
    process.env.ALLOWED_EMAILS = email
    await db()`insert into allowlist (email, blocked) values (${email}, true)`
    expect(await isAllowed(email)).toBe(false)
  })

  it('normalizes case and whitespace on both sides', async () => {
    process.env.ALLOWED_EMAILS = ' Person@Example.com '
    expect(await isAllowed('PERSON@EXAMPLE.COM')).toBe(true)
  })
})

describe('the allowlist cache', () => {
  const email = 'cached@example.com'

  it('is invalidated when a block is written, so it takes effect at once', async () => {
    await db()`insert into allowlist (email) values (${email})`
    expect(await isAllowed(email)).toBe(true)

    await db()`update allowlist set blocked = true where email = ${email}`
    // Without invalidation the cached "allowed" would stand for up to 60s.
    invalidateAllowlistCache(email)
    expect(await isAllowed(email)).toBe(false)
  })

  it('caches negative results too', async () => {
    expect(await isAllowed('never@example.com')).toBe(false)
    expect(await isAllowed('never@example.com')).toBe(false)
  })
})

describe('the session cookie', () => {
  it('is httpOnly, path-scoped, lax and seven days long', () => {
    const cookie = sessionCookie('token-value')
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=token-value`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Max-Age=604800')
  })

  it('omits Secure locally, so Safari does not silently drop the session', () => {
    delete process.env.VERCEL
    expect(sessionCookie('t')).not.toContain('Secure')
  })

  it('sets Secure when deployed', () => {
    process.env.VERCEL = '1'
    expect(sessionCookie('t')).toContain('Secure')
    expect(clearedCookie()).toContain('Secure')
  })

  it('clears with an immediate expiry', () => {
    expect(clearedCookie()).toContain('Max-Age=0')
  })
})

describe('session verification', () => {
  const email = 'signed@example.com'

  beforeEach(async () => {
    await db()`insert into allowlist (email) values (${email}) on conflict do nothing`
    invalidateAllowlistCache()
  })

  it('accepts a token it signed', async () => {
    const token = await signSession({ id: '11111111-1111-1111-1111-111111111111', email })
    const user = await requireUser(fakeReq({ [SESSION_COOKIE_NAME]: token }), fakeRes())
    expect(user).toMatchObject({ email, isDebug: false, isAdmin: false })
  })

  it('rejects a tampered token and clears the cookie', async () => {
    const token = await signSession({ id: '11111111-1111-1111-1111-111111111111', email })
    const tampered = `${token.slice(0, -3)}xyz`
    const res = fakeRes()
    await expect(
      requireUser(fakeReq({ [SESSION_COOKIE_NAME]: tampered }), res),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0')
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession({ id: '11111111-1111-1111-1111-111111111111', email })
    process.env.SESSION_SECRET = 'b'.repeat(48)
    await expect(
      requireUser(fakeReq({ [SESSION_COOKIE_NAME]: token }), fakeRes()),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects a missing cookie', async () => {
    await expect(requireUser(fakeReq(), fakeRes())).rejects.toMatchObject({ status: 401 })
  })

  it('re-checks the allowlist on EVERY request, so a block cuts off an open session', async () => {
    // The acceptance criterion: blocking takes effect on the next request, not
    // the next login. A valid, unexpired cookie must stop working.
    const token = await signSession({ id: '11111111-1111-1111-1111-111111111111', email })
    const cookie = { [SESSION_COOKIE_NAME]: token }
    await expect(requireUser(fakeReq(cookie), fakeRes())).resolves.toMatchObject({ email })

    await db()`update allowlist set blocked = true where email = ${email}`
    invalidateAllowlistCache(email)

    await expect(requireUser(fakeReq(cookie), fakeRes())).rejects.toMatchObject({ status: 401 })
    expect(await readUser(fakeReq(cookie))).toBeNull()
  })

  it('refuses to sign without a secret, and refuses a short one', async () => {
    delete process.env.SESSION_SECRET
    await expect(signSession({ id: 'x', email })).rejects.toBeInstanceOf(ConfigError)
    process.env.SESSION_SECRET = 'too-short'
    await expect(signSession({ id: 'x', email })).rejects.toBeInstanceOf(ConfigError)
  })
})

describe('Google token verification fails closed', () => {
  it('throws a ConfigError when GOOGLE_CLIENT_ID is absent', async () => {
    // The sharpest requirement in §5: google-auth-library skips audience
    // checking when no audience is supplied, which would accept tokens minted
    // for ANY Google OAuth client. A config gap must never widen who can sign in.
    delete process.env.GOOGLE_CLIENT_ID
    await expect(verifyGoogleIdToken('any-token')).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects a malformed token when the client id IS set', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
    await expect(verifyGoogleIdToken('not-a-jwt')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    })
  })
})
