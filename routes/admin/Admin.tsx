import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { ArrowLeft, Ban, CheckCircle2, MoreVertical, Trash2, UserPlus } from 'lucide-react'
import { ConfirmDialog, ErrorState, SkeletonList } from '@/components/ui'
import { apiFetch, errorMessage } from '@/utils/api'
import type { AdminUser, AllowlistRow, PromptRow } from '@/types/api'

/**
 * The administration area (functional spec §6.9).
 *
 * Contains NO food data. The types it consumes (AllowlistRow, AdminUser) have no
 * field that could carry a description, image key, score or rationale, so the
 * guarantee is enforced by the compiler rather than by care.
 */
export function AdminLayout() {
  return (
    <>
      <header className="flex items-center gap-2 py-3">
        <Link to="/me" aria-label="Volver" className="tap grid place-items-center rounded-lg text-slate-600">
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Administración</h1>
      </header>

      <p className="rounded-card bg-slate-100 px-3 py-2 text-xs text-slate-600">
        Esta sección no contiene datos de comida. Se muestra la cantidad de registros; nunca su contenido.
      </p>

      <nav aria-label="Secciones de administración" className="mt-3 flex gap-1 rounded-lg bg-slate-200 p-1">
        {[
          { to: '/admin/users', label: 'Usuarios' },
          { to: '/admin/prompts', label: 'Prompts' },
        ].map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `tap flex-1 rounded-md text-center text-sm font-semibold ${
                isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-4">
        <Outlet />
      </div>
    </>
  )
}

export function AdminUsers() {
  const [rows, setRows] = useState<AllowlistRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<{ email: string; count: number } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const result = await apiFetch<{ allowlist: AllowlistRow[] }>('/api/admin/allowlist')
      setRows(result.allowlist)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = useCallback(
    async (run: () => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      try {
        await run()
        await load()
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const startDelete = useCallback(async (target: string) => {
    setError(null)
    try {
      // Fetch the count first, so the confirmation can state the consequence
      // exactly -- without showing any of the content.
      const info = await apiFetch<AdminUser>(`/api/admin/users?email=${encodeURIComponent(target)}`)
      setDeleting({ email: target, count: info.entry_count })
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const value = email.trim().toLowerCase()
          if (!value) return
          void act(async () => {
            await apiFetch('/api/admin/allowlist', { method: 'POST', body: { email: value } })
            setEmail('')
          })
        }}
        className="flex gap-2"
      >
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="persona@ejemplo.com"
          aria-label="Correo para invitar"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={busy || email.trim().length === 0}
          className="tap flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          <UserPlus className="size-4" aria-hidden="true" />
          Invitar
        </button>
      </form>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {rows === null && !error ? <SkeletonList rows={3} /> : null}

      {rows !== null && rows.length === 0 ? (
        <p className="mt-6 text-center text-sm text-slate-500">Todavía no hay nadie invitado.</p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {(rows ?? []).map((row) => (
          <li key={row.email} className="rounded-card bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900" title={row.email}>
                {row.email}
              </span>
              <StatusChip row={row} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    apiFetch('/api/admin/allowlist', {
                      method: 'PATCH',
                      body: { email: row.email, blocked: !row.blocked },
                    }),
                  )
                }
                className="tap rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700"
              >
                {row.blocked ? 'Desbloquear' : 'Bloquear'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    apiFetch(`/api/admin/allowlist?email=${encodeURIComponent(row.email)}`, {
                      method: 'DELETE',
                    }),
                  )
                }
                className="tap rounded-lg border border-amber-300 px-3 text-xs font-semibold text-amber-800"
              >
                Quitar de la lista
              </button>
              {row.has_signed_in ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startDelete(row.email)}
                  className="tap flex items-center gap-1 rounded-lg border border-red-300 px-3 text-xs font-semibold text-red-700"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Eliminar usuario y datos
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={deleting !== null}
        title="¿Eliminar este usuario y todos sus datos?"
        destructive
        requireText={deleting?.email}
        confirmLabel="Eliminar definitivamente"
        pending={busy}
        body={
          deleting ? (
            <p>
              Esto elimina definitivamente{' '}
              <strong className="font-semibold">
                {deleting.count} {deleting.count === 1 ? 'registro' : 'registros'}
              </strong>
              . El contenido de los registros nunca se muestra aquí. Esto no se puede deshacer.
            </p>
          ) : null
        }
        onConfirm={() => {
          const target = deleting
          if (!target) return
          void act(async () => {
            await apiFetch(`/api/admin/users?email=${encodeURIComponent(target.email)}`, {
              method: 'DELETE',
              body: { confirm_entry_count: target.count },
            })
            setDeleting(null)
          })
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function StatusChip({ row }: { row: AllowlistRow }) {
  if (row.blocked) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
        <Ban className="size-3" aria-hidden="true" />
        Bloqueado
      </span>
    )
  }
  if (row.has_signed_in) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-score-p2-soft px-2 py-0.5 text-xs font-semibold text-score-p2-ink">
        <CheckCircle2 className="size-3" aria-hidden="true" />
        Activo
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
      <MoreVertical className="size-3" aria-hidden="true" />
      Invitado
    </span>
  )
}

export function AdminPrompts() {
  const [prompts, setPrompts] = useState<PromptRow[] | null>(null)
  const [active, setActive] = useState<PromptRow['key']>('scoring_prompt')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const result = await apiFetch<{ prompts: PromptRow[] }>('/api/admin/prompts')
      setPrompts(result.prompts)
      const current = result.prompts.find((prompt) => prompt.key === active)
      if (current) setDraft(current.body)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [active])

  useEffect(() => {
    void load()
  }, [load])

  const current = prompts?.find((prompt) => prompt.key === active)
  const dirty = current !== undefined && draft !== current.body

  // Guard a reload or tab close while an edit is unsaved. Full in-app navigation
  // blocking would need a data router, which the declarative mode this app uses
  // does not provide, so the affordances we render are guarded instead.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return (
    <>
      <p className="rounded-card bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Guardar afecta solo a los análisis futuros. Los registros existentes conservan su puntaje.
      </p>

      <div className="mt-3 flex gap-1 rounded-lg bg-slate-200 p-1">
        {(['scoring_prompt', 'image_analysis_prompt'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={active === key}
            onClick={() => {
              setActive(key)
              const next = prompts?.find((prompt) => prompt.key === key)
              setDraft(next?.body ?? '')
            }}
            className={`tap flex-1 rounded-md text-xs font-semibold ${
              active === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {key === 'scoring_prompt' ? 'Puntaje' : 'Análisis de imagen'}
          </button>
        ))}
      </div>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {current ? (
        <>
          <p className="mt-3 text-xs text-slate-500">
            versión {current.version}
            {current.updated_by ? ` · última edición de ${current.updated_by}` : ''}
          </p>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={20}
            spellCheck={false}
            aria-label="Cuerpo del prompt"
            className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs"
          />
          <p className="mt-1 text-right text-xs text-slate-400">{draft.length} caracteres</p>

          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              disabled={busy || !dirty || draft.trim().length < 20}
              onClick={() => {
                setBusy(true)
                apiFetch('/api/admin/prompts', {
                  method: 'PUT',
                  body: { key: active, body: draft },
                })
                  .then(() => load())
                  .catch((err) => setError(errorMessage(err)))
                  .finally(() => setBusy(false))
              }}
              className="tap w-full rounded-lg bg-slate-900 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              disabled={busy || !current.can_revert}
              onClick={() => setConfirmRevert(true)}
              className="tap w-full rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              Volver a la versión anterior
            </button>
            {dirty ? (
              <button
                type="button"
                onClick={() => setDraft(current.body)}
                className="tap w-full rounded-lg text-sm font-semibold text-slate-600"
              >
                Descartar cambios
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmRevert}
        title="¿Restaurar la versión anterior?"
        body="Tu texto actual será reemplazado por la versión guardada antes."
        confirmLabel="Restaurar"
        pending={busy}
        onConfirm={() => {
          setBusy(true)
          apiFetch('/api/admin/prompts', {
            method: 'POST',
            body: { key: active, action: 'revert' },
          })
            .then(() => load())
            .catch((err) => setError(errorMessage(err)))
            .finally(() => {
              setBusy(false)
              setConfirmRevert(false)
            })
        }}
        onCancel={() => setConfirmRevert(false)}
      />
    </>
  )
}
