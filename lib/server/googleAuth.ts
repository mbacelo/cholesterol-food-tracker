import { OAuth2Client } from 'google-auth-library'
import { ApiError, ConfigError } from './errors.js'

/**
 * Google ID token verification (tech spec §5).
 *
 * The browser's only interaction with Google produces an ID token; this is where
 * it is checked. Nothing here trusts anything the client decoded.
 */

export interface GoogleIdentity {
  /** Stable Google account id. The identity we key users on -- an email can change. */
  sub: string
  email: string
  emailVerified: boolean
  name: string | null
  picture: string | null
}

let client: OAuth2Client | undefined

/**
 * Verifies a Google ID token, or throws.
 *
 * FAILS CLOSED on a missing GOOGLE_CLIENT_ID, and does so before the client is
 * even constructed. This is the sharpest requirement in §5: google-auth-library
 * skips audience checking entirely when no audience is supplied, so a
 * configuration gap would silently accept tokens minted for ANY Google OAuth
 * client -- anyone could mint a token elsewhere and sign in as anyone. A missing
 * variable must never widen who can sign in.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new ConfigError('GOOGLE_CLIENT_ID is not set')

  client ??= new OAuth2Client()

  let payload
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId })
    payload = ticket.getPayload()
  } catch {
    // Never surface the library's message: it can echo token contents.
    throw new ApiError(401, 'unauthorized')
  }

  if (!payload) throw new ApiError(401, 'unauthorized')

  // Belt over the library's own checks. Cheap, and each one is a real attack.
  const issuerOk =
    payload.iss === 'accounts.google.com' || payload.iss === 'https://accounts.google.com'
  if (!issuerOk) throw new ApiError(401, 'unauthorized')
  if (!payload.sub || !payload.email) throw new ApiError(401, 'unauthorized')
  // An unverified email could be anyone's: it must not match an allowlist entry.
  if (payload.email_verified !== true) throw new ApiError(401, 'unauthorized')

  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    name: payload.name ?? null,
    picture: payload.picture ?? null,
  }
}

/** Resets the memoized client. Tests only. */
export function resetGoogleClient(): void {
  client = undefined
}
