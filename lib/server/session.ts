import { SignJWT, jwtVerify } from 'jose'
import { assertAllowed } from './allowlist.js'
import { DEBUG_EMAIL, isAdminEmail } from './admins.js'
import { getDebugUser } from './debug.js'
import { debugEnabled } from './env.js'
import { ApiError, ConfigError } from './errors.js'
import type { ApiRequest, ApiResponse } from './http.js'

/**
 * The session cookie, and the two gates every handler goes through.
 *
 * Google is contacted exactly once, at sign-in. After that every request
 * authenticates from a signed httpOnly cookie: no Google round trip, no token in
 * JavaScript, and the session survives the app being backgrounded on a phone.
 */

export interface SessionUser {
  id: string
  email: string
  isAdmin: boolean
  isDebug: boolean
}

const COOKIE_NAME = 'ft_session'
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60
const ISSUER = 'food-tracker'
const AUDIENCE = 'food-tracker'

function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new ConfigError('SESSION_SECRET is not set')
  // A short secret makes an HS256 signature guessable, which would let anyone
  // mint a session for any user id.
  if (secret.length < 32) {
    throw new ConfigError('SESSION_SECRET must be at least 32 characters')
  }
  return new TextEncoder().encode(secret)
}

export async function signSession(user: { id: string; email: string }): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(signingKey())
}

/**
 * Builds the Set-Cookie value.
 *
 * `Secure` is emitted only when deployed. Chrome and Firefox accept Secure
 * cookies on http://localhost but Safari historically does not, so setting it
 * unconditionally would make local development in Safari silently lose the
 * session -- which looks exactly like an auth bug and is miserable to trace.
 */
export function sessionCookie(token: string): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ]
  if (process.env.VERCEL) parts.push('Secure')
  return parts.join('; ')
}

export function clearedCookie(): string {
  const parts = [`${COOKIE_NAME}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0']
  if (process.env.VERCEL) parts.push('Secure')
  return parts.join('; ')
}

interface SessionClaims {
  sub: string
  email: string
}

async function readClaims(req: ApiRequest): Promise<SessionClaims | null> {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    })
    const sub = payload.sub
    const email = typeof payload.email === 'string' ? payload.email : undefined
    if (!sub || !email) return null
    return { sub, email }
  } catch {
    // Expired, tampered, or signed with a rotated secret. All the same to us.
    return null
  }
}

/**
 * The authenticated user, or null. Never throws for an absent session.
 *
 * Used by GET /api/session, where "not signed in" is an ordinary answer rather
 * than an error.
 */
export async function readUser(req: ApiRequest): Promise<SessionUser | null> {
  if (debugEnabled()) return getDebugUser()

  const claims = await readClaims(req)
  if (!claims) return null
  try {
    await assertAllowed(claims.email)
  } catch {
    return null
  }
  return {
    id: claims.sub,
    email: claims.email,
    isAdmin: isAdminEmail(claims.email),
    isDebug: false,
  }
}

/**
 * Requires a valid session, or throws.
 *
 * The order here is the security review, so it is written out plainly:
 *   1. debug mode short-circuits to the seeded local user (local only);
 *   2. the cookie must exist;
 *   3. the JWT must verify;
 *   4. the email must STILL be allowed -- re-checked on every request, because a
 *      7-day cookie would otherwise outlive a block;
 *   5. admin status comes from the env var, never from the token or a table.
 *
 * A failure at step 3 or 4 clears the cookie and returns 401 rather than 403: the
 * session itself is no longer valid, and the client's correct reaction is to sign
 * in again.
 */
export async function requireUser(req: ApiRequest, res: ApiResponse): Promise<SessionUser> {
  if (debugEnabled()) return getDebugUser()

  const claims = await readClaims(req)
  if (!claims) {
    res.setHeader('Set-Cookie', clearedCookie())
    throw new ApiError(401, 'unauthorized')
  }

  try {
    await assertAllowed(claims.email)
  } catch {
    res.setHeader('Set-Cookie', clearedCookie())
    throw new ApiError(401, 'unauthorized')
  }

  return {
    id: claims.sub,
    email: claims.email,
    isAdmin: isAdminEmail(claims.email),
    isDebug: false,
  }
}

/**
 * Requires an administrator.
 *
 * 403 here is the NORMAL path for every ordinary user -- the client probes this
 * once per sign-in to decide whether to show the admin menu item, and a failed
 * probe must never surface as an error. Hiding the menu is a convenience; this
 * check, re-run on every admin action, is the actual boundary.
 */
export async function requireAdmin(req: ApiRequest, res: ApiResponse): Promise<SessionUser> {
  const user = await requireUser(req, res)
  if (!user.isAdmin) throw new ApiError(403, 'forbidden')
  return user
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_SECONDS
export { DEBUG_EMAIL }
