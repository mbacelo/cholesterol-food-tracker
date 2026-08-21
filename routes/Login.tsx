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

/**
 * Whether the Google Identity Services script has finished loading.
 *
 * It is tagged `async` in index.html, so it routinely resolves AFTER React has
 * mounted. Sampling `window.google` once during an effect therefore loses a real
 * race on a cold cache or a slow connection -- and losing it used to leave the
 * button permanently unrendered, with no spinner and no error: the only way into
 * the app, failing silently.
 */
type ScriptStatus = 'waiting' | 'ready' | 'failed'

/** How long to wait before calling it: generous, since the cost of giving up early is a locked-out user. */
const SCRIPT_TIMEOUT_MS = 15_000

export default function Login() {
  const { state, signIn } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [script, setScript] = useState<ScriptStatus>(() =>
    typeof window !== 'undefined' && window.google ? 'ready' : 'waiting',
  )
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

  // Wait for the script rather than sampling it once. Listening to the tag's own
  // load event is the fast path; the interval covers the case where the script
  // finished between this component mounting and the listener being attached.
  useEffect(() => {
    if (script !== 'waiting') return

    let settled = false
    const ready = () => {
      if (settled) return
      settled = true
      setScript('ready')
    }

    if (window.google) {
      ready()
      return
    }

    const tag = document.getElementById('gsi-client')
    tag?.addEventListener('load', ready)
    tag?.addEventListener('error', () => {
      if (settled) return
      settled = true
      setScript('failed')
    })

    const poll = setInterval(() => {
      if (window.google) ready()
    }, 200)
    const giveUp = setTimeout(() => {
      if (settled) return
      settled = true
      setScript('failed')
    }, SCRIPT_TIMEOUT_MS)

    return () => {
      clearInterval(poll)
      clearTimeout(giveUp)
      tag?.removeEventListener('load', ready)
    }
  }, [script])

  useEffect(() => {
    if (initialized.current || script !== 'ready' || !clientId || !buttonRef.current) return
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
  }, [clientId, handleCredential, script])

  // An already-signed-in user opening the installed app must never see a login
  // screen.
  if (state.status === 'ready') return <Navigate to="/today" replace />

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Registro de Colesterol</h1>
      <p className="mt-2 text-sm text-slate-600">
        Registra un plato, mira su efecto probable en tu LDL y sigue tu objetivo.
      </p>

      {state.status === 'anonymous' && state.reason === 'expired' ? (
        <p role="status" className="mt-4 text-sm text-amber-800">
          Tu sesión expiró. Inicia sesión de nuevo — el plato que estabas revisando sigue aquí.
        </p>
      ) : null}

      <div className="mt-8">
        {busy ? <Spinner label="Iniciando sesión" /> : null}
        {!busy && clientId && script === 'waiting' ? <Spinner label="Cargando el inicio de sesión" /> : null}
        {/* Kept mounted whenever the script is usable: renderButton needs the node. */}
        <div ref={buttonRef} hidden={busy || script !== 'ready'} />
      </div>

      {!busy && clientId && script === 'failed' ? (
        <div role="alert" className="mt-4">
          <p className="text-sm text-slate-700">
            No se pudo cargar el inicio de sesión de Google. Revisa tu conexión e inténtalo de
            nuevo.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="tap mt-3 rounded-lg bg-slate-900 px-6 font-semibold text-white"
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {!clientId ? (
        <p className="mt-6 text-sm text-red-700">
          VITE_GOOGLE_CLIENT_ID no está configurado, así que no se puede mostrar el inicio de
          sesión. Para desarrollo local, usa DEBUG_AUTH=true en .env.local.
        </p>
      ) : null}

      {error ? <ErrorState message={error} /> : null}

      <p className="mt-10 text-xs text-slate-500">El acceso es por invitación.</p>
    </main>
  )
}

export function NotAuthorized() {
  const { signOut } = useSession()
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-bold text-slate-900">Sin autorización</h1>
      <p className="mt-2 text-sm text-slate-600">
        Esta cuenta de Google no está en la lista de invitados. Si crees que debería estar,
        pídele a la persona que administra la app que la agregue.
      </p>
      <button
        type="button"
        onClick={() => {
          window.google?.accounts.id.disableAutoSelect()
          void signOut()
        }}
        className="tap mt-8 rounded-lg bg-slate-900 px-6 font-semibold text-white"
      >
        Usar otra cuenta
      </button>
    </main>
  )
}
