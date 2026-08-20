import { assertAllowed } from '../lib/server/allowlist.js'
import { assertMethod, handleError } from '../lib/server/errors.js'
import { debugEnabled } from '../lib/server/env.js'
import { verifyGoogleIdToken } from '../lib/server/googleAuth.js'
import { getDebugUser } from '../lib/server/debug.js'
import type { ApiRequest, ApiResponse } from '../lib/server/http.js'
import { zSession } from '../lib/requests.js'
import { clearedCookie, readUser, sessionCookie, signSession } from '../lib/server/session.js'
import { getSettings, provisionUser } from '../lib/server/users.js'

/**
 * Sign in, read the current session, sign out.
 *
 * Handler order is fixed and written out plainly in every file under api/,
 * because the visible order IS the security review:
 *   method check -> authenticate -> allowlist -> rate limit -> validate -> delegate
 *
 * There is no SQL, no prompt text and no business rule in this file.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['GET', 'POST', 'DELETE'])

    if (req.method === 'GET') return await readSession(req, res)
    if (req.method === 'POST') return await signIn(req, res)
    return signOut(res)
  } catch (err) {
    return handleError(res, err, `${req.method} /api/session`)
  }
}

/**
 * Session rehydrate, called once when the SPA loads.
 *
 * A 401 here is a NORMAL answer meaning "not signed in", not an error the client
 * should surface. Without this the client would have to infer identity from the
 * settings endpoint, which conflates two concerns and cannot distinguish "not
 * signed in" from "not authorized".
 */
async function readSession(req: ApiRequest, res: ApiResponse): Promise<void> {
  const user = await readUser(req)
  if (!user) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  const settings = await getSettings(user.id)
  res.status(200).json({
    user: { id: user.id, email: user.email },
    is_admin: user.isAdmin,
    debug: user.isDebug,
    settings,
  })
}

async function signIn(req: ApiRequest, res: ApiResponse): Promise<void> {
  // Debug mode skips authentication entirely and ignores whatever was posted
  // (functional spec §2.1). The gate is local-only and cannot be satisfied by a
  // deployed build.
  if (debugEnabled()) {
    const user = await getDebugUser()
    const settings = await getSettings(user.id)
    res.setHeader('Set-Cookie', sessionCookie(await signSession(user)))
    res.status(200).json({
      user: { id: user.id, email: user.email },
      is_admin: user.isAdmin,
      debug: true,
      settings,
    })
    return
  }

  const { id_token } = zSession.parse(req.body)

  // Verify with Google before the allowlist is consulted: an unverified token
  // tells us nothing about who is actually asking.
  const identity = await verifyGoogleIdToken(id_token)

  // Throws the distinct not_authorized code, so the UI can say "not authorized"
  // rather than showing a generic failure.
  await assertAllowed(identity.email)

  // Provisioned on first successful login.
  const user = await provisionUser(identity)

  res.setHeader('Set-Cookie', sessionCookie(await signSession(user)))
  res.status(200).json({
    user: { id: user.id, email: user.email },
    is_admin: user.is_admin,
    debug: false,
    settings: {
      daily_average_target: user.daily_average_target,
      min_entries_for_valid_day: user.min_entries_for_valid_day,
    },
  })
}

/** Idempotent: clearing an absent cookie is still a success. */
function signOut(res: ApiResponse): void {
  res.setHeader('Set-Cookie', clearedCookie())
  res.status(204).send('')
}
