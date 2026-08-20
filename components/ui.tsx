import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Loader2, RefreshCw, WifiOff, X } from 'lucide-react'

/**
 * The small shared pieces. One shape per state, so six screens do not each
 * invent their own empty, loading and error rendering.
 */

/**
 * `label={null}` is for a spinner sitting INSIDE something that already
 * announces itself -- a live region, or a button whose text changes. Two nested
 * role="status" nodes make a screen reader say it twice.
 */
export function Spinner({
  label = 'Cargando',
  className = 'text-slate-400',
}: {
  label?: string | null
  className?: string
}) {
  const icon = <Loader2 className={`size-5 animate-spin ${className}`} aria-hidden="true" />
  if (label === null) return icon
  return (
    <span role="status" aria-label={label} className="inline-flex items-center">
      {icon}
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-slate-200 ${className}`} />
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="mt-3 space-y-2" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-center gap-3 rounded-card bg-white p-3">
          <Skeleton className="size-14 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="size-10 shrink-0" />
        </li>
      ))}
    </ul>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode
  title: string
  body?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mt-10 flex flex-col items-center px-6 text-center">
      {icon ? <div className="mb-3 text-slate-400">{icon}</div> : null}
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {body ? <p className="mt-1 text-sm text-slate-600">{body}</p> : null}
      {action ? <div className="mt-5 w-full max-w-xs">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="mt-8 rounded-card border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" />
        <p className="text-sm text-red-900">{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="tap mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Reintentar
        </button>
      ) : null}
    </div>
  )
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine === false : false,
  )
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  if (!offline) return null
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-slate-800 px-3 py-1.5 text-xs font-medium text-white"
    >
      <WifiOff className="size-3.5" aria-hidden="true" />
      Estás sin conexión. Para registrar necesitas conexión.
    </div>
  )
}

/**
 * One dialog for all four destructive flows (delete entry, discard analysis,
 * delete user and data, revert prompt).
 *
 * A bottom sheet below md: a centered modal puts the confirm button mid-screen,
 * where a thumb has to stretch for it.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirmar',
  destructive = false,
  requireText,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body: React.ReactNode
  confirmLabel?: string
  destructive?: boolean
  requireText?: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement
    dialogRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      ;(returnFocus.current as HTMLElement | null)?.focus?.()
    }
  }, [open, onCancel])

  useEffect(() => {
    if (!open) setTyped('')
  }, [open])

  if (!open) return null
  const blocked = requireText !== undefined && typed.trim() !== requireText

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-safe outline-none md:rounded-2xl md:pb-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar"
            className="tap -mr-2 -mt-2 grid place-items-center rounded-lg text-slate-500"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-2 text-sm text-slate-700">{body}</div>

        {requireText !== undefined ? (
          <label className="mt-4 block text-sm">
            <span className="text-slate-700">
              Escribe <span className="font-mono font-semibold">{requireText}</span> para confirmar
            </span>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={blocked || pending}
            onClick={onConfirm}
            className={`tap flex w-full items-center justify-center gap-2 rounded-lg px-4 font-semibold text-white disabled:opacity-50 ${
              destructive ? 'bg-red-600' : 'bg-slate-900'
            }`}
          >
            {pending ? <Spinner label={null} className="text-white" /> : null}
            {pending ? 'Procesando…' : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="tap w-full rounded-lg px-4 font-semibold text-slate-700"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

/** Single polite live region, for "Entry saved" and similar. */
export function Toast({ message }: { message: string | null }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center">
      {message ? (
        <span className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {message}
        </span>
      ) : null}
    </div>
  )
}
