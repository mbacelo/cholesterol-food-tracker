import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, ChefHat, ImageOff, Pencil, ShoppingBag, Trash2 } from 'lucide-react'
import { ConfirmDialog, ErrorState, Skeleton } from '@/components/ui'
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
          aria-label="Back"
          className="tap grid place-items-center rounded-lg text-slate-600"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        <h1 className="flex-1 truncate text-lg font-bold text-slate-900">Entry</h1>
        {!editing ? (
          <>
            <button
              type="button"
              onClick={openEdit}
              aria-label="Edit"
              className="tap grid place-items-center rounded-lg text-slate-600"
            >
              <Pencil className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete"
              className="tap grid place-items-center rounded-lg text-red-600"
            >
              <Trash2 className="size-5" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </header>

      {entry.has_image ? (
        <img
          src={`/api/image?entry=${entry.id}`}
          alt=""
          className="w-full rounded-card object-cover"
        />
      ) : (
        <div className="grid h-32 place-items-center rounded-card bg-slate-100">
          <ImageOff className="size-8 text-slate-300" aria-hidden="true" />
        </div>
      )}

      <section aria-label="Score" className="mt-4 rounded-card bg-white p-4">
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
              {entry.is_homemade ? 'Homemade' : 'Bought'} · {formatFullDate(entry.entry_date)}
            </p>
          </div>
        </div>
        {/* Read-only, and there is no input anywhere near it. */}
        <p className="mt-3 text-sm text-slate-700">{entry.rationale}</p>
        <FactorLists positive={entry.positive_factors} negative={entry.negative_factors} />
      </section>

      {editing ? (
        <section aria-label="Edit" className="mt-4 space-y-4 rounded-card bg-white p-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Description</span>
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
              {isHomemade ? 'Made at home' : 'Bought or eaten out'}
            </span>
          </button>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Date</span>
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
              Changing the description or the homemade setting re-scores the entry.
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
              className="tap w-full rounded-lg bg-slate-900 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Working…' : rescoreChanged ? 'Re-score' : 'Apply'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="tap w-full rounded-lg text-sm font-semibold text-slate-600"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {/* The re-score confirmation. The user sees the new result and can confirm
          or cancel, but cannot alter it. */}
      <ConfirmDialog
        open={preview !== null}
        title="New score"
        pending={busy}
        confirmLabel="Keep this score"
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
        title="Delete this entry?"
        body="The photo is deleted too. This cannot be undone."
        confirmLabel="Delete"
        destructive
        pending={busy}
        onConfirm={() => void destroy()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
