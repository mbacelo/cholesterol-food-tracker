import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router'
import { useSession } from '@/context/SessionContext'
import { ErrorState, Spinner } from '@/components/ui'
import { errorMessage } from '@/utils/api'

/**
 * Google-only sign-in (functional spec §2). No local passwords, no sign-up form.
 *
 * Google Identity Services renders its own button and hands us a credential; the
 * server verifies it. Any client-side decode would be for display only, so we do
 * none.
 */

interface GoogleAccounts {
  accounts: {
    id: {
      initialize(config: {
        client_id: string
        callback: (response: { credential: string }) => void
      }): void
      renderButton(parent: HTMLElement, options: Record<string, unknown>): void
      disableAutoSelect(): void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleAccounts
  }
}

export default function Login() {
  const { state, signIn } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  const handleCredential = useCallback(
    async (credential: string) => {
      setBusy(true)
      setError(null)
      try {
        await signIn(credential)
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [signIn],
  )

  useEffect(() => {
    if (initialized.current || !clientId || !buttonRef.current) return
    const google = window.google
    if (!google) return
    initialized.current = true
    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => void handleCredential(response.credential),
    })
    google.accounts.id.renderButton(buttonRef.current, {
      theme: 'outline',
      size: 'large',
      width: 280,
      text: 'signin_with',
    })
  }, [clientId, handleCredential])

  // An already-signed-in user opening the installed app must never see a login
  // screen.
  if (state.status === 'ready') return <Navigate to="/today" replace />

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Cholesterol Food Tracker</h1>
      <p className="mt-2 text-sm text-slate-600">
        Log a dish, see its likely effect on your LDL, and track it against your goal.
      </p>

      {state.status === 'anonymous' && state.reason === 'expired' ? (
        <p role="status" className="mt-4 text-sm text-amber-800">
          Your session expired. Sign in again — any dish you were reviewing is still here.
        </p>
      ) : null}

      <div className="mt-8">
        {busy ? <Spinner label="Signing in" /> : <div ref={buttonRef} />}
      </div>

      {!clientId ? (
        <p className="mt-6 text-sm text-red-700">
          VITE_GOOGLE_CLIENT_ID is not set, so sign-in cannot be shown. For local development, set
          DEBUG_AUTH=true in .env.local instead.
        </p>
      ) : null}

      {error ? <ErrorState message={error} /> : null}

      <p className="mt-10 text-xs text-slate-500">Access is by invitation.</p>
    </main>
  )
}

export function NotAuthorized() {
  const { signOut } = useSession()
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-bold text-slate-900">Not authorized</h1>
      <p className="mt-2 text-sm text-slate-600">
        This Google account is not on the invitation list. If you think it should be, ask the
        person who runs this app to add it.
      </p>
      <button
        type="button"
        onClick={() => {
          window.google?.accounts.id.disableAutoSelect()
          void signOut()
        }}
        className="tap mt-8 rounded-lg bg-slate-900 px-6 font-semibold text-white"
      >
        Use a different account
      </button>
    </main>
  )
}
