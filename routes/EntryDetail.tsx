import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, ChefHat, Pencil, ShoppingBag, Trash2 } from 'lucide-react'
import { ConfirmDialog, ErrorState, Skeleton, Spinner } from '@/components/ui'
import { FactorLists, ScoreBadge } from '@/components/score'
import { apiFetch, errorMessage } from '@/utils/api'
import { MIN_ENTRY_DATE, formatFullDate, todayLocal } from '@/utils/localDate'
import type { AnalysisResponse, Entry } from '@/types/api'

/**
 * View, edit and delete one entry (functional spec §6.4).
 *
 * Editing snapshots the original into a ref when edit mode opens and restores it
 * on cancel (tech spec §8), so a half-finished edit never leaks into the view.
 *
 * A description or homemade change shows the new result for confirmation BEFORE
 * committing. The preview comes from /api/analyze; the commit is a PATCH, which
 * re-scores server-side and hits the cache, so the confirmed number is the stored
 * number. The client never sends a score.
 */
export default function EntryDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const [entry, setEntry] = useState<Entry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState('')
  const [isHomemade, setIsHomemade] = useState(true)
  const [entryDate, setEntryDate] = useState('')
  const [preview, setPreview] = useState<AnalysisResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const snapshot = useRef<{ description: string; isHomemade: boolean; entryDate: string } | null>(
    null,
  )

  const load = useCallback(async () => {
    setError(null)
    try {
      const result = await apiFetch<{ entry: Entry }>(`/api/entries?id=${id}`)
      setEntry(result.entry)
      setDescription(result.entry.description)
      setIsHomemade(result.entry.is_homemade)
      setEntryDate(result.entry.entry_date)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const openEdit = () => {
    if (!entry) return
    snapshot.current = {
      description: entry.description,
      isHomemade: entry.is_homemade,
      entryDate: entry.entry_date,
    }
    setEditing(true)
  }

  const cancelEdit = () => {
    const saved = snapshot.current
    if (saved) {
      setDescription(saved.description)
      setIsHomemade(saved.isHomemade)
      setEntryDate(saved.entryDate)
    }
    setPreview(null)
    setEditing(false)
  }

  const rescoreChanged =
    entry !== null &&
    (description.trim() !== entry.description.trim() || isHomemade !== entry.is_homemade)

  const apply = useCallback(async () => {
    if (!entry) return
    setBusy(true)
    setError(null)
    try {
      if (!rescoreChanged) {
        // A date-only change commits directly: no model call, no confirmation.
        const result = await apiFetch<{ entry: Entry }>(`/api/entries?id=${entry.id}`, {
          method: 'PATCH',
          body: { entry_date: entryDate },
        })
        setEntry(result.entry)
        setEditing(false)
        return
      }
      // Preview first, so the user sees the new score and can cancel.
      const analysis = await apiFetch<AnalysisResponse>('/api/analyze', {
        method: 'POST',
        body: { description: description.trim(), is_homemade: isHomemade },
      })
      // The Log flow blocks Save on this; so must an edit, or the same text that
      // cannot be logged in the first place can be committed onto an existing
      // entry through the back door.
      if (!analysis.food_detected) {
        setError('Eso no describe un plato reconocible. Corrige la descripción.')
        return
      }
      setPreview(analysis)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [description, entry, entryDate, isHomemade, rescoreChanged])

  const commit = useCallback(async () => {
    if (!entry) return
    setBusy(true)
    try {
      const result = await apiFetch<{ entry: Entry }>(`/api/entries?id=${entry.id}`, {
        method: 'PATCH',
        body: { description: description.trim(), is_homemade: isHomemade, entry_date: entryDate },
      })
      setEntry(result.entry)
      setPreview(null)
      setEditing(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [description, entry, entryDate, isHomemade])

  const destroy = useCallback(async () => {
    if (!entry) return
    setBusy(true)
    try {
      await apiFetch(`/api/entries?id=${entry.id}`, { method: 'DELETE' })
      navigate('/history')
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }, [entry, navigate])

  if (error && !entry) {
    return <ErrorState message={error} onRetry={() => void load()} />
  }

  if (!entry) {
    return (
      <div className="mt-4 space-y-3">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  return (
    <>
      <header className="flex items-center gap-2 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Volver"
          className="tap grid place-items-center rounded-lg text-slate-600"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        <h1 className="flex-1 truncate text-lg font-bold text-slate-900">Registro</h1>
        {!editing ? (
          <>
            <button
              type="button"
              onClick={openEdit}
              aria-label="Editar"
              className="tap grid place-items-center rounded-lg text-slate-600"
            >
              <Pencil className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Eliminar"
              className="tap grid place-items-center rounded-lg text-red-600"
            >
              <Trash2 className="size-5" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </header>

      <section aria-label="Puntaje" className="mt-4 rounded-card bg-white p-4">
        <div className="flex items-center gap-3">
          <ScoreBadge score={entry.score} size="xl" showIcon />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-900">{entry.description}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              {entry.is_homemade ? (
                <ChefHat className="size-3.5" aria-hidden="true" />
              ) : (
                <ShoppingBag className="size-3.5" aria-hidden="true" />
              )}
              {entry.is_homemade ? 'Casero' : 'Comprado'} · {formatFullDate(entry.entry_date)}
            </p>
          </div>
        </div>
        {/* Read-only, and there is no input anywhere near it. */}
        <p className="mt-3 text-sm text-slate-700">{entry.rationale}</p>
        <FactorLists positive={entry.positive_factors} negative={entry.negative_factors} />
      </section>

      {editing ? (
        <section aria-label="Editar" className="mt-4 space-y-4 rounded-card bg-white p-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Descripción</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, 200))}
              rows={3}
              maxLength={200}
              className="mt-1 w-full rounded-lg border border-slate-300 p-3"
            />
          </label>
          <button
            type="button"
            onClick={() => setIsHomemade((value) => !value)}
            aria-pressed={isHomemade}
            className="tap flex w-full items-center gap-3 rounded-lg border border-slate-300 px-3 text-left"
          >
            {isHomemade ? (
              <ChefHat className="size-5 text-slate-600" aria-hidden="true" />
            ) : (
              <ShoppingBag className="size-5 text-slate-600" aria-hidden="true" />
            )}
            <span className="flex-1 text-sm font-medium">
              {isHomemade ? 'Hecho en casa' : 'Comprado o comido fuera'}
            </span>
          </button>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Fecha</span>
            <input
              type="date"
              value={entryDate}
              max={todayLocal()}
              min={MIN_ENTRY_DATE}
              onChange={(event) => setEntryDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 p-3"
            />
          </label>

          {rescoreChanged ? (
            <p className="text-xs text-slate-500">
              Cambiar la descripción o si es casero recalcula el puntaje del registro.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={busy || description.trim().length === 0}
              onClick={() => void apply()}
              className="tap flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 font-semibold text-white disabled:opacity-50"
            >
              {/* The button's own text is the status, so the spinner beside it
                  is decorative -- otherwise it is announced twice. */}
              {busy ? <Spinner label={null} className="text-white" /> : null}
              {busy
                ? rescoreChanged
                  ? 'Calculando el puntaje…'
                  : 'Guardando…'
                : rescoreChanged
                  ? 'Recalcular puntaje'
                  : 'Aplicar'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="tap w-full rounded-lg text-sm font-semibold text-slate-600"
            >
              Cancelar
            </button>
          </div>
        </section>
      ) : null}

      {/* The re-score confirmation. The user sees the new result and can confirm
          or cancel, but cannot alter it. */}
      <ConfirmDialog
        open={preview !== null}
        title="Puntaje nuevo"
        pending={busy}
        confirmLabel="Conservar este puntaje"
        body={
          preview ? (
            <div>
              <div className="flex items-center gap-3">
                <ScoreBadge score={entry.score} size="md" />
                <span aria-hidden="true">→</span>
                <ScoreBadge score={preview.score} size="lg" showIcon />
              </div>
              <p className="mt-3 text-sm text-slate-700">{preview.rationale}</p>
              <FactorLists
                positive={preview.positive_factors}
                negative={preview.negative_factors}
              />
            </div>
          ) : null
        }
        onConfirm={() => void commit()}
        onCancel={() => setPreview(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="¿Eliminar este registro?"
        body="Esto no se puede deshacer."
        confirmLabel="Eliminar"
        destructive
        pending={busy}
        onConfirm={() => void destroy()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
