import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Camera, ChefHat, Images, PenLine, RotateCcw, ShoppingBag } from 'lucide-react'
import { ScreenHeader } from '@/components/shell'
import { ConfirmDialog, ErrorState, Skeleton, Spinner } from '@/components/ui'
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
 * Analysis is NEVER automatic. Every model call originates in a tap -- the photo
 * pick, "Score this dish", or "Re-score" -- so no keystroke, blur or timer can
 * spend money, and React 19 StrictMode's double-invoked effects cannot
 * double-charge the endpoint. Editing the description leaves the old score on
 * screen, marked stale, with Save blocked until the user asks for a re-score.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'compressing' }
  // `mode` only picks the wording and the scan overlay: reading a photo and
  // re-scoring typed text are the same call, but they do not look the same to
  // someone waiting on them.
  | { kind: 'analyzing'; mode: 'image' | 'score' }
  | { kind: 'review' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }

export default function Log() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [image, setImage] = useState<StoredImage | null>(null)
  const [description, setDescription] = useState('')
  const [isHomemade, setIsHomemade] = useState(true)
  const [entryDate, setEntryDate] = useState(todayLocal())
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [scoredHash, setScoredHash] = useState<string | null>(null)
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
          // Only the photo path clears. `food_detected: false` means "no food in
          // the IMAGE" (functional spec 6.1), and the fallback is to ask the user
          // to type something -- so wiping text they just typed would delete the
          // very thing being asked for.
          if (nextDescription.trim().length === 0) setDescription('')
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

        setPhase({ kind: 'analyzing', mode: 'image' })
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

  const analyzeNow = useCallback(async () => {
    // With no description yet, the photo is what is being read -- same call, but
    // "Analizando imagen…" is what is actually happening.
    const mode = description.trim().length === 0 && image !== null ? 'image' : 'score'
    setPhase({ kind: 'analyzing', mode })
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
          // No image: the photo was input to /api/analyze and nothing more. The
          // description it produced is the record (tech spec §6).
        },
      })
      clearCapture()
      navigate('/today', { state: { savedEntryId: result.entry.id } })
    } catch (err) {
      setPhase({ kind: 'error', message: errorMessage(err) })
    }
  }, [description, entryDate, isHomemade, navigate])

  const discard = useCallback(() => {
    abortRef.current?.abort()
    clearCapture()
    setConfirmDiscard(false)
    navigate('/today')
  }, [navigate])

  if (phase.kind === 'idle') {
    return (
      <>
        <ScreenHeader title="Registrar un plato" subtitle="No se guarda nada hasta que toques Guardar." />
        <div className="mt-4 space-y-3">
          <FilePicker label="Sacar foto" Icon={Camera} capture onPick={pickFile} />
          <FilePicker label="Elegir de la galería" Icon={Images} onPick={pickFile} />
          <button
            type="button"
            onClick={startTyped}
            className="tap flex w-full items-center justify-center gap-2 rounded-card border border-slate-300 bg-white px-4 font-semibold text-slate-900"
          >
            <PenLine className="size-5" aria-hidden="true" />
            Escribirlo
          </button>
        </div>
      </>
    )
  }

  if (phase.kind === 'compressing' || phase.kind === 'analyzing' || phase.kind === 'saving') {
    const readingImage = phase.kind === 'analyzing' && phase.mode === 'image'
    const copy =
      phase.kind === 'compressing'
        ? 'Preparando la foto…'
        : phase.kind === 'analyzing'
          ? readingImage
            ? 'Analizando imagen…'
            : 'Calculando el puntaje…'
          : 'Guardando…'
    return (
      <>
        <ScreenHeader title="Registrar un plato" />

        {/* One live region for the whole state. The spinners inside are
            decorative (label={null}) so it is announced once, not three times. */}
        <div role="status" aria-live="polite" aria-busy="true" className="mt-1">
          {image ? (
            <figure className="relative overflow-hidden rounded-card bg-slate-200">
              <img src={image.dataUrl} alt="" className="max-h-64 w-full object-cover" />
              {readingImage ? (
                <span
                  aria-hidden="true"
                  className="animate-scan absolute inset-x-0 top-0 h-1/3 bg-linear-to-b from-transparent via-white/55 to-transparent"
                />
              ) : null}
              {/* On the photo rather than under it: the caption is about THIS
                  image, and the gradient keeps white text legible on any dish. */}
              <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-linear-to-t from-slate-950/80 via-slate-950/45 to-transparent px-4 pb-3 pt-10 text-sm font-semibold text-white">
                <Spinner label={null} className="text-white" />
                {copy}
              </figcaption>
            </figure>
          ) : (
            <p className="flex items-center gap-2 rounded-card bg-white p-4 text-sm font-medium text-slate-700">
              <Spinner label={null} />
              {copy}
            </p>
          )}

          {/* The shape of the answer, in the place the answer will appear. A
              lone spinner says "wait"; this says what is being waited for. */}
          {phase.kind === 'analyzing' ? (
            <>
              <div className="mt-4 rounded-card bg-white p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-16 shrink-0 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-11/12" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <Skeleton className="h-7 w-28 rounded-lg" />
                  <Skeleton className="h-7 w-20 rounded-lg" />
                  <Skeleton className="h-7 w-24 rounded-lg" />
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-slate-400">
                Suele tardar unos segundos.
              </p>
            </>
          ) : null}
        </div>
      </>
    )
  }

  if (phase.kind === 'error') {
    return (
      <>
        <ScreenHeader title="Registrar un plato" />
        {/* Retry the call that failed, rather than dropping the user back on the
            review screen to find the button themselves. With nothing analyzable
            yet there is nothing to retry, so just return to the form. */}
        <ErrorState
          message={phase.message}
          onRetry={() => {
            if (canAnalyze) void analyzeNow()
            else setPhase({ kind: 'review' })
          }}
        />
        <button
          type="button"
          onClick={discard}
          className="tap mt-3 w-full rounded-lg text-sm font-semibold text-slate-600"
        >
          Empezar de nuevo
        </button>
      </>
    )
  }

  const noFood = analysis !== null && !analysis.food_detected

  return (
    <>
      <ScreenHeader title="Revisar" subtitle="Tú describes la comida; la app decide el puntaje." />

      {image ? (
        <>
          <img
            src={image.dataUrl}
            alt=""
            className="mt-1 max-h-56 w-full rounded-card object-cover"
          />
          {/* Said once, here: the photo is a way to describe the dish, not part
              of the record. Without this the preview implies it is being saved. */}
          <p className="mt-2 text-xs text-slate-500">
            La foto sólo sirve para identificar el plato; no se guarda.
          </p>
        </>
      ) : null}
      {imageVolatile ? (
        <p className="mt-2 text-xs text-amber-700">
          Esta foto no sobrevivirá a una recarga de la página (el almacenamiento está lleno).
        </p>
      ) : null}

      {noFood ? (
        <div role="status" className="mt-4 rounded-card border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            No pude identificar comida en esta foto. Describe el plato y le calcularé el
            puntaje.
          </p>
        </div>
      ) : null}

      {analysis && analysis.food_detected ? (
        <section aria-label="Puntaje" className="mt-4 rounded-card bg-white p-4">
          <div className="flex items-center gap-3">
            <ScoreBadge score={analysis.score} size="xl" showIcon />
            <p className="flex-1 text-sm text-slate-700">{analysis.rationale}</p>
          </div>
          <FactorLists
            positive={analysis.positive_factors}
            negative={analysis.negative_factors}
          />
          {dirty ? (
            <p role="status" className="mt-3 text-sm text-amber-700">
              Este puntaje corresponde al texto anterior. Toca Recalcular para actualizarlo.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="mt-4 space-y-4 rounded-card bg-white p-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Descripción</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value.slice(0, 200))}
            rows={3}
            maxLength={200}
            enterKeyHint="done"
            autoCapitalize="sentences"
            placeholder="Tallarines con pesto, o los ingredientes principales"
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
            {isHomemade ? 'Hecho en casa' : 'Comprado o comido fuera'}
          </span>
          <span className="text-xs text-slate-500">toca para cambiar</span>
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
          {entryDate > todayLocal() ? (
            <span role="alert" className="mt-1 block text-xs text-red-700">
              La fecha no puede estar en el futuro.
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
          Calcular el puntaje
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
            Recalcular
          </button>
        ) : null}
        <button
          type="button"
          disabled={
            analysis === null ||
            !analysis.food_detected ||
            dirty ||
            description.trim().length === 0 ||
            entryDate > todayLocal()
          }
          onClick={() => void save()}
          className="tap w-full rounded-lg bg-slate-900 font-semibold text-white disabled:opacity-50"
        >
          Guardar
        </button>
        <button
          type="button"
          onClick={() => (analysis ? setConfirmDiscard(true) : discard())}
          className="tap w-full rounded-lg text-sm font-semibold text-slate-600"
        >
          Descartar
        </button>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="¿Descartar este análisis?"
        body="No se guardó nada. Se perderán el puntaje y la foto."
        confirmLabel="Descartar"
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
    <label className="tap flex w-full items-center justify-center gap-2 rounded-card bg-slate-900 px-4 font-semibold text-white">
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
