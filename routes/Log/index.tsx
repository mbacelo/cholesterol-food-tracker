import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Camera, ChefHat, Images, PenLine, RotateCcw, ShoppingBag } from 'lucide-react'
import { ScreenHeader } from '@/components/shell'
import { ConfirmDialog, ErrorState, Spinner } from '@/components/ui'
import { FactorLists, ScoreBadge } from '@/components/score'
import { apiFetch, errorMessage } from '@/utils/api'
import { compressImage, ImageError } from '@/utils/image'
import { MIN_ENTRY_DATE, todayLocal } from '@/utils/localDate'
import type { AnalysisResponse, Entry } from '@/types/api'
import {
  clearCapture,
  inputHash,
  loadCapture,
  saveDraft,
  saveImage,
  type StoredDraft,
  type StoredImage,
} from './captureStorage'

/**
 * The capture flow (functional spec §6.1), and the quick check (§6.2) -- they are
 * the same screen, because nothing is stored until Save.
 *
 * Analysis is NEVER triggered from a bare effect. Every model call originates in
 * an event handler, which is what makes React 19 StrictMode's double-invoked
 * effects unable to double-charge the endpoint.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'compressing' }
  | { kind: 'analyzing' }
  | { kind: 'review' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }

const DEBOUNCE_MS = 900

export default function Log() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [image, setImage] = useState<StoredImage | null>(null)
  const [description, setDescription] = useState('')
  const [isHomemade, setIsHomemade] = useState(true)
  const [entryDate, setEntryDate] = useState(todayLocal())
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [scoredHash, setScoredHash] = useState<string | null>(null)
  const [rescoring, setRescoring] = useState(false)
  const [rescoreError, setRescoreError] = useState<string | null>(null)
  const [imageVolatile, setImageVolatile] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const restored = useRef(false)
  const requestSeq = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  // Restore a draft ONCE, and only into the review step. A refresh that landed
  // during `analyzing` comes back with the photo intact but requires an explicit
  // tap to spend money again -- it never auto-resumes into a paid call.
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const { image: storedImage, draft } = loadCapture()
    if (storedImage) setImage(storedImage)
    if (!draft) return
    setDescription(draft.description)
    setIsHomemade(draft.isHomemade)
    setEntryDate(draft.entryDate)
    if (draft.analysis) {
      setAnalysis(draft.analysis)
      setScoredHash(draft.scoredHash)
      setPhase({ kind: 'review' })
    } else if (storedImage || draft.description) {
      setPhase({ kind: 'review' })
    }
  }, [])

  const persist = useCallback(
    (over: Partial<StoredDraft> = {}) => {
      const draft: StoredDraft = {
        source: image ? 'camera' : 'typed',
        description,
        isHomemade,
        entryDate,
        analysis,
        scoredHash,
        ...over,
      }
      saveDraft(draft)
    },
    [analysis, description, entryDate, image, isHomemade, scoredHash],
  )

  useEffect(() => {
    if (phase.kind === 'review') persist()
  }, [persist, phase.kind])

  const runAnalysis = useCallback(
    async (nextDescription: string, nextHomemade: boolean, withImage: StoredImage | null) => {
      const seq = ++requestSeq.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const hash = inputHash(nextDescription, nextHomemade)
      try {
        const result = await apiFetch<AnalysisResponse>('/api/analyze', {
          method: 'POST',
          body: {
            ...(nextDescription.trim().length > 0 ? { description: nextDescription.trim() } : {}),
            is_homemade: nextHomemade,
            // A typed description is authoritative, so the image is not re-sent:
            // it would cost image tokens for a text-only answer and split the
            // cache key.
            ...(withImage && nextDescription.trim().length === 0
              ? { image: { content_type: withImage.contentType, data_base64: withImage.base64 } }
              : {}),
          },
          signal: controller.signal,
        })
        // Drop a stale response: typing fast must not land an intermediate score.
        if (seq !== requestSeq.current) return null
        setAnalysis(result)
        setScoredHash(hash)
        if (!result.food_detected) {
          setDescription('')
        } else if (nextDescription.trim().length === 0) {
          setDescription(result.description)
          setScoredHash(inputHash(result.description, nextHomemade))
        }
        return result
      } catch (err) {
        if ((err as Error).name === 'AbortError') return null
        throw err
      }
    },
    [],
  )

  const pickFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setPhase({ kind: 'compressing' })
      try {
        const compressed = await compressImage(file)
        const stored: StoredImage = {
          dataUrl: compressed.dataUrl,
          base64: compressed.base64,
          contentType: compressed.contentType,
          bytes: compressed.bytes,
        }
        setImage(stored)
        // Persist the image BEFORE the paid call, so a refresh mid-analysis does
        // not lose the photo.
        if (!saveImage(stored)) setImageVolatile(true)

        setPhase({ kind: 'analyzing' })
        await runAnalysis('', isHomemade, stored)
        setPhase({ kind: 'review' })
      } catch (err) {
        const message = err instanceof ImageError ? err.message : errorMessage(err)
        setPhase({ kind: 'error', message })
      }
    },
    [isHomemade, runAnalysis],
  )

  const startTyped = useCallback(() => {
    setPhase({ kind: 'review' })
  }, [])

  const dirty = analysis !== null && scoredHash !== inputHash(description, isHomemade)
  const canAnalyze = description.trim().length > 0 || image !== null

  // Re-score on a settled edit. Debounced, because each trigger is a POTENTIAL
  // paid call -- the cache makes repeats free, but a first-time phrase is not.
  useEffect(() => {
    if (phase.kind !== 'review') return
    if (!dirty || description.trim().length === 0) return
    const timer = setTimeout(() => {
      setRescoring(true)
      setRescoreError(null)
      runAnalysis(description, isHomemade, image)
        .catch((err) => setRescoreError(errorMessage(err)))
        .finally(() => setRescoring(false))
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [description, dirty, image, isHomemade, phase.kind, runAnalysis])

  const analyzeNow = useCallback(async () => {
    setPhase({ kind: 'analyzing' })
    try {
      await runAnalysis(description, isHomemade, image)
      setPhase({ kind: 'review' })
    } catch (err) {
      setPhase({ kind: 'error', message: errorMessage(err) })
    }
  }, [description, image, isHomemade, runAnalysis])

  const save = useCallback(async () => {
    setPhase({ kind: 'saving' })
    try {
      const result = await apiFetch<{ entry: Entry }>('/api/entries', {
        method: 'POST',
        body: {
          entry_date: entryDate,
          description: description.trim(),
          is_homemade: isHomemade,
          ...(image
            ? { image: { content_type: image.contentType, data_base64: image.base64 } }
            : {}),
        },
      })
      clearCapture()
      navigate('/today', { state: { savedEntryId: result.entry.id } })
    } catch (err) {
      setPhase({ kind: 'error', message: errorMessage(err) })
    }
  }, [description, entryDate, image, isHomemade, navigate])

  const discard = useCallback(() => {
    abortRef.current?.abort()
    clearCapture()
    setConfirmDiscard(false)
    navigate('/today')
  }, [navigate])

  if (phase.kind === 'idle') {
    return (
      <>
        <ScreenHeader title="Log a dish" subtitle="Nothing is saved until you tap Save." />
        <div className="mt-4 space-y-3">
          <FilePicker label="Take photo" Icon={Camera} capture onPick={pickFile} />
          <FilePicker label="Choose from gallery" Icon={Images} onPick={pickFile} />
          <button
            type="button"
            onClick={startTyped}
            className="tap flex w-full items-center justify-center gap-2 rounded-card border border-slate-300 bg-white px-4 font-semibold text-slate-900"
          >
            <PenLine className="size-5" aria-hidden="true" />
            Type it
          </button>
        </div>
      </>
    )
  }

  if (phase.kind === 'compressing' || phase.kind === 'analyzing' || phase.kind === 'saving') {
    const copy =
      phase.kind === 'compressing'
        ? 'Preparing photo…'
        : phase.kind === 'analyzing'
          ? 'Scoring this dish…'
          : 'Saving…'
    return (
      <>
        <ScreenHeader title="Log a dish" />
        <div role="status" aria-live="polite" className="mt-6 flex flex-col items-center gap-3">
          {image ? (
            <img src={image.dataUrl} alt="" className="max-h-56 rounded-card object-cover" />
          ) : null}
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Spinner /> {copy}
          </p>
          {phase.kind === 'analyzing' ? (
            <p className="text-xs text-slate-400">Usually a few seconds.</p>
          ) : null}
        </div>
      </>
    )
  }

  if (phase.kind === 'error') {
    return (
      <>
        <ScreenHeader title="Log a dish" />
        <ErrorState message={phase.message} onRetry={() => setPhase({ kind: 'review' })} />
        <button
          type="button"
          onClick={discard}
          className="tap mt-3 w-full rounded-lg text-sm font-semibold text-slate-600"
        >
          Start over
        </button>
      </>
    )
  }

  const noFood = analysis !== null && !analysis.food_detected

  return (
    <>
      <ScreenHeader title="Review" subtitle="You describe the food; the app decides the score." />

      {image ? (
        <img src={image.dataUrl} alt="" className="mt-1 max-h-56 w-full rounded-card object-cover" />
      ) : null}
      {imageVolatile ? (
        <p className="mt-2 text-xs text-amber-700">
          This photo will not survive a page refresh (storage is full).
        </p>
      ) : null}

      {noFood ? (
        <div role="status" className="mt-4 rounded-card border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            I could not identify food in this photo. Describe the dish and I will score it — the
            photo stays attached.
          </p>
        </div>
      ) : null}

      {analysis && analysis.food_detected ? (
        <section aria-label="Score" className="mt-4 rounded-card bg-white p-4">
          <div className="flex items-center gap-3">
            <ScoreBadge score={analysis.score} size="xl" showIcon pending={rescoring} />
            <p className="flex-1 text-sm text-slate-700">{analysis.rationale}</p>
          </div>
          <FactorLists
            positive={analysis.positive_factors}
            negative={analysis.negative_factors}
          />
          {rescoreError ? (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {rescoreError}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="mt-4 space-y-4 rounded-card bg-white p-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value.slice(0, 200))}
            onBlur={() => {
              // Blur re-scores immediately, so someone who types and taps Save
              // is not waiting on a timer.
              if (dirty && description.trim().length > 0) {
                setRescoring(true)
                runAnalysis(description, isHomemade, image)
                  .catch((err) => setRescoreError(errorMessage(err)))
                  .finally(() => setRescoring(false))
              }
            }}
            rows={3}
            maxLength={200}
            enterKeyHint="done"
            autoCapitalize="sentences"
            placeholder="Tagliatelle with pesto, or the main ingredients"
            className="mt-1 w-full rounded-lg border border-slate-300 p-3"
          />
          <span
            className={`mt-1 block text-right text-xs ${
              description.length >= 190 ? 'text-score-m3-ink' : 'text-slate-400'
            }`}
          >
            {description.length}/200
          </span>
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
          <span className="flex-1 text-sm font-medium text-slate-900">
            {isHomemade ? 'Made at home' : 'Bought or eaten out'}
          </span>
          <span className="text-xs text-slate-500">tap to change</span>
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
          {entryDate > todayLocal() ? (
            <span role="alert" className="mt-1 block text-xs text-red-700">
              Dates cannot be in the future.
            </span>
          ) : null}
        </label>
      </div>

      {analysis === null ? (
        <button
          type="button"
          disabled={!canAnalyze}
          onClick={() => void analyzeNow()}
          className="tap mt-4 w-full rounded-lg bg-slate-900 font-semibold text-white disabled:opacity-50"
        >
          Score this dish
        </button>
      ) : null}

      {/* In normal flow, NOT sticky. A sticky bar inside the scroll container
          floats up over the fields below it, which put the homemade toggle and
          the date picker underneath the Save button and out of reach. The page's
          own bottom padding already clears the nav. */}
      <div className="mt-5 flex flex-col gap-2">
        {dirty ? (
          <button
            type="button"
            onClick={() => void analyzeNow()}
            className="tap flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Re-score now
          </button>
        ) : null}
        <button
          type="button"
          disabled={
            analysis === null ||
            !analysis.food_detected ||
            dirty ||
            rescoring ||
            description.trim().length === 0 ||
            entryDate > todayLocal()
          }
          onClick={() => void save()}
          className="tap w-full rounded-lg bg-slate-900 font-semibold text-white disabled:opacity-50"
        >
          {rescoring ? 'Re-scoring…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => (analysis ? setConfirmDiscard(true) : discard())}
          className="tap w-full rounded-lg text-sm font-semibold text-slate-600"
        >
          Discard
        </button>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this analysis?"
        body="Nothing has been saved. The score and photo will be lost."
        confirmLabel="Discard"
        destructive
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  )
}

function FilePicker({
  label,
  Icon,
  capture = false,
  onPick,
}: {
  label: string
  Icon: typeof Camera
  capture?: boolean
  onPick: (file: File | undefined) => void
}) {
  return (
    <label className="tap flex w-full cursor-pointer items-center justify-center gap-2 rounded-card bg-slate-900 px-4 font-semibold text-white">
      <Icon className="size-5" aria-hidden="true" />
      {label}
      <input
        type="file"
        accept="image/*"
        // capture="environment" opens the rear camera directly; no native shell.
        {...(capture ? { capture: 'environment' as const } : {})}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Reset, so re-picking the same file fires change again.
          event.target.value = ''
          onPick(file)
        }}
      />
    </label>
  )
}
