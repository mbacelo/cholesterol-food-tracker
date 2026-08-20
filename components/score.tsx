import { ChefHat, ImageOff, Minus, ShoppingBag, TrendingDown, TrendingUp } from 'lucide-react'
import { Link } from 'react-router'
import { formatAverage, formatScore, scoreColor } from '@/utils/scoreColor'
import { formatDayLabel } from '@/utils/localDate'
import type { DayStatus } from '@/domain/aggregation'
import type { Entry, Factor } from '@/types/api'

/**
 * Everywhere a score appears.
 *
 * One component, so functional spec §4.1's "used consistently everywhere a score
 * appears, and always shown with the signed number" holds by construction. Note
 * it renders a <span>: there is no input here, anywhere, which is how "no
 * interface lets a user alter a score" is satisfied structurally rather than by
 * hiding a control.
 */

const SIZES = {
  sm: 'h-9 min-w-9 px-2 text-sm',
  md: 'h-10 min-w-10 px-2.5 text-base',
  lg: 'h-12 min-w-12 px-3 text-lg',
  xl: 'h-16 min-w-16 px-4 text-3xl',
} as const

export function ScoreBadge({
  score,
  size = 'sm',
  showIcon = false,
  pending = false,
}: {
  score: number
  size?: keyof typeof SIZES
  showIcon?: boolean
  pending?: boolean
}) {
  const colors = scoreColor(score)
  const Icon = score > 0 ? TrendingUp : score < 0 ? TrendingDown : Minus

  if (pending) {
    return (
      <span
        aria-busy="true"
        aria-label="calculando puntaje"
        className={`inline-flex animate-pulse items-center justify-center rounded-xl bg-slate-200 font-bold ${SIZES[size]}`}
      />
    )
  }

  return (
    <span
      aria-label={`puntaje ${score > 0 ? 'más ' : score < 0 ? 'menos ' : ''}${Math.abs(score)} de 5`}
      className={`inline-flex items-center justify-center gap-1 rounded-xl font-bold tabular-nums ${colors.solidBg} ${colors.onSolid} ${SIZES[size]}`}
    >
      {showIcon ? <Icon className="size-4" aria-hidden="true" /> : null}
      {formatScore(score)}
    </span>
  )
}

/** Fractional averages, with an em dash for "not logged" -- never a zero. */
export function ScoreAverage({
  average,
  size = 'xl',
}: {
  average: number | null
  size?: 'md' | 'xl'
}) {
  const colors = scoreColor(average ?? 0)
  return (
    <span
      className={`font-bold tabular-nums ${average === null ? 'text-slate-400' : colors.text} ${
        size === 'xl' ? 'text-hero' : 'text-xl'
      }`}
    >
      {formatAverage(average)}
    </span>
  )
}

/**
 * A factor chip. Binary colouring, not the eleven-stop ramp: a factor is
 * directional, not graded.
 *
 * The reason is always visible rather than hidden in a tooltip -- "every score is
 * explained" is a design principle, and a tooltip does not exist on a phone.
 */
export function FactorChip({ kind, factor }: { kind: 'positive' | 'negative'; factor: Factor }) {
  const colors = kind === 'positive' ? scoreColor(2) : scoreColor(-3)
  return (
    <li
      className={`flex flex-wrap items-baseline gap-x-1.5 rounded-lg px-2.5 py-1.5 text-sm ${colors.softBg} ${colors.text}`}
    >
      <span className="font-semibold">
        {kind === 'positive' ? '+' : '−'} {factor.label}
      </span>
      <span className="text-xs opacity-80">({factor.reason})</span>
    </li>
  )
}

export function FactorLists({
  positive,
  negative,
}: {
  positive: Factor[]
  negative: Factor[]
}) {
  if (positive.length === 0 && negative.length === 0) return null
  return (
    <div className="mt-3 space-y-2">
      {positive.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {positive.map((factor) => (
            <FactorChip key={`p-${factor.label}`} kind="positive" factor={factor} />
          ))}
        </ul>
      ) : null}
      {negative.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {negative.map((factor) => (
            <FactorChip key={`n-${factor.label}`} kind="negative" factor={factor} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function HomemadeIcon({ isHomemade }: { isHomemade: boolean }) {
  const Icon = isHomemade ? ChefHat : ShoppingBag
  return (
    <>
      <Icon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
      <span className="sr-only">{isHomemade ? 'Casero' : 'Comprado'}</span>
    </>
  )
}

export function EntryThumbnail({ entry }: { entry: Entry }) {
  if (!entry.has_image) {
    return (
      <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-slate-100">
        <ImageOff className="size-5 text-slate-300" aria-hidden="true" />
      </div>
    )
  }
  return (
    <img
      src={`/api/image?entry=${entry.id}`}
      alt=""
      width={56}
      height={56}
      loading="lazy"
      decoding="async"
      className="size-14 shrink-0 rounded-lg object-cover"
    />
  )
}

/** One row, shared by Today and History so they cannot drift apart. */
export function EntryRow({ entry, highlight = false }: { entry: Entry; highlight?: boolean }) {
  return (
    <li>
      <Link
        to={`/entry/${entry.id}`}
        className={`flex items-center gap-3 rounded-card bg-white p-3 ${
          highlight ? `ring-2 ${scoreColor(entry.score).ring}` : ''
        }`}
      >
        <EntryThumbnail entry={entry} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-medium text-slate-900">
            {entry.description}
          </span>
          <span className="mt-1 flex items-center gap-1">
            <HomemadeIcon isHomemade={entry.is_homemade} />
          </span>
        </span>
        <ScoreBadge score={entry.score} size="sm" />
      </Link>
    </li>
  )
}

const STATUS_COPY: Record<DayStatus, string> = {
  pass: 'En objetivo',
  miss: 'Bajo objetivo',
  incomplete: 'Incompleto',
}

/** A day header for History: date, that day's average, and the entry count. */
export function DayHeader({
  date,
  count,
  average,
  status,
  searchMode = false,
}: {
  date: string
  count: number
  average?: number | null
  status?: DayStatus
  searchMode?: boolean
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 bg-slate-50/95 px-1 py-2 backdrop-blur">
      <h2 className="text-sm font-semibold text-slate-900">{formatDayLabel(date)}</h2>
      {searchMode ? (
        // With a search active, the visible entries are a filtered subset, so a
        // "day average" beside them would be misleading.
        <span className="text-xs text-slate-500">
          {count} {count === 1 ? 'coincidencia' : 'coincidencias'}
        </span>
      ) : (
        <>
          <span className="text-xs text-slate-500">
            {count} {count === 1 ? 'registro' : 'registros'}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {status ? (
              <span className="text-xs font-medium text-slate-500">{STATUS_COPY[status]}</span>
            ) : null}
            {average === undefined ? (
              <span className="text-sm text-slate-400">…</span>
            ) : (
              <ScoreAverage average={average} size="md" />
            )}
          </span>
        </>
      )}
    </div>
  )
}
