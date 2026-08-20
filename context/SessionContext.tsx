import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { apiFetch, setUnauthorizedHandler, type ApiError } from '@/utils/api'
import type { SessionResponse, Settings } from '@/types/api'

/**
 * Session and user settings. Nothing else (tech spec §2).
 *
 * No entries, no drafts, no admin data -- those belong to the screens that own
 * them. Putting them here is what turns a small context into a global store that
 * re-renders the whole app.
 *
 * The admin probe resolves as part of the SAME bootstrap as the session, so
 * `isAdmin` is a settled boolean by the first render of any screen. That is what
 * stops the admin menu item appearing and then vanishing.
 */

export interface SessionUser {
  id: string
  email: string
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason: 'initial' | 'signed_out' | 'expired' }
  | { status: 'not_authorized' }
  | { status: 'error'; message: string }
  | { status: 'ready'; user: SessionUser; settings: Settings; isAdmin: boolean; debug: boolean }

interface SessionApi {
  state: SessionState
  signIn(googleCredential: string): Promise<void>
  signOut(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  retry(): void
}

const SessionContext = createContext<SessionApi | null>(null)

export function useSession(): SessionApi {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside SessionProvider')
  return context
}

/** For the 95% of components that only render inside the authenticated shell. */
export function useReadySession(): Extract<SessionState, { status: 'ready' }> {
  const { state } = useSession()
  if (state.status !== 'ready') throw new Error('expected a ready session')
  return state
}

/**
 * Probes whether the caller is an administrator.
 *
 * A 403 is the NORMAL answer for every ordinary user, so this never rejects and
 * never logs: any non-200 simply means "not admin". Surfacing it as an error
 * would put a scary message on the screen of every non-admin.
 */
async function probeAdmin(): Promise<boolean> {
  try {
    await apiFetch('/api/admin/ping', { reportUnauthorized: false })
    return true
  } catch {
    return false
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  // React 19 StrictMode invokes effects twice in development. The ref keeps
  // bootstrap to one round trip.
  const started = useRef(false)

  const bootstrap = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const [session, isAdmin] = await Promise.all([
        apiFetch<SessionResponse>('/api/session', { reportUnauthorized: false }),
        probeAdmin(),
      ])
      setState({
        status: 'ready',
        user: session.user,
        settings: session.settings,
        // Trust the session's own answer when it has one; the probe is a
        // fallback for deployments where /api/session omits it.
        isAdmin: session.is_admin || isAdmin,
        debug: session.debug,
      })
    } catch (err) {
      const error = err as ApiError
      if (error.code === 'unauthorized') {
        setState({ status: 'anonymous', reason: 'initial' })
      } else if (error.code === 'not_authorized') {
        setState({ status: 'not_authorized' })
      } else {
        // A flaky connection must not look like a sign-out.
        setState({ status: 'error', message: error.message })
      }
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState((current) =>
        current.status === 'ready' ? { status: 'anonymous', reason: 'expired' } : current,
      )
    })
  }, [])

  const signIn = useCallback(
    async (googleCredential: string) => {
      const session = await apiFetch<SessionResponse>('/api/session', {
        method: 'POST',
        body: { id_token: googleCredential },
        reportUnauthorized: false,
      })
      const isAdmin = session.is_admin || (await probeAdmin())
      setState({
        status: 'ready',
        user: session.user,
        settings: session.settings,
        isAdmin,
        debug: session.debug,
      })
    },
    [],
  )

  const signOut = useCallback(async () => {
    try {
      await apiFetch('/api/session', { method: 'DELETE', reportUnauthorized: false })
    } finally {
      setState({ status: 'anonymous', reason: 'signed_out' })
    }
  }, [])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    // Optimistic: the control should not lag behind the finger. Rolled back below
    // if the write fails.
    let previous: Settings | undefined
    setState((current) => {
      if (current.status !== 'ready') return current
      previous = current.settings
      return { ...current, settings: { ...current.settings, ...patch } }
    })
    try {
      const result = await apiFetch<{ settings: Settings }>('/api/settings', {
        method: 'PATCH',
        body: patch,
      })
      setState((current) =>
        current.status === 'ready' ? { ...current, settings: result.settings } : current,
      )
    } catch (err) {
      if (previous) {
        const restore = previous
        setState((current) =>
          current.status === 'ready' ? { ...current, settings: restore } : current,
        )
      }
      throw err
    }
  }, [])

  return (
    <SessionContext.Provider
      value={{ state, signIn, signOut, updateSettings, retry: () => void bootstrap() }}
    >
      {children}
    </SessionContext.Provider>
  )
}
