import { ChefHat, Minus, ShoppingBag, TrendingDown, TrendingUp } from 'lucide-react'
import { Link } from 'react-router'
import { formatAverage, formatScore, scoreColor } from '@/utils/scoreColor'
import { formatDayLabel } from '@/utils/localDate'
import { finalizeScore, type ScoreRule } from '@/domain/scoring'
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
}: {
  score: number
  size?: keyof typeof SIZES
  showIcon?: boolean
}) {
  const colors = scoreColor(score)
  const Icon = score > 0 ? TrendingUp : score < 0 ? TrendingDown : Minus

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

/**
 * The Spanish name for each post-rule. The `why` strings on a ScoreStep are
 * developer prose, in English, and are not for display.
 */
const RULE_COPY: Record<ScoreRule, string> = {
  proxy_cap: 'Las dos penalizaciones por «no se puede saber» suman −1 como máximo',
  trans_fat_cap: 'La grasa trans industrial limita el puntaje a −2',
  whole_plant_floor: 'Plato basado solo en vegetales, así que recibe al menos +1',
  whole_plant_floor_suppressed: 'No se aplica el mínimo vegetal: el plato tiene grasa trans',
  clamp: 'El resultado se limita al rango −5..+5',
}

/** The five stored inputs. Shaped so both an Entry and an analysis preview fit. */
export interface ScoreDerivationInput {
  modifier_sum: number | null
  has_trans_fat: boolean | null
  whole_plant_only: boolean | null
  proxy_ultra_processed: boolean | null
  proxy_unidentified_fat: boolean | null
}

/**
 * How the score was reached: the modifier sum, then each post-rule that moved it.
 *
 * The steps are re-derived here by calling the same `finalizeScore` the server
 * used, rather than stored as text. The rules live in exactly one place, so this
 * panel cannot describe a rule the scoring no longer applies.
 *
 * Renders nothing for an entry logged before the breakdown was stored.
 */
export function ScoreDerivation({ entry }: { entry: ScoreDerivationInput }) {
  if (entry.modifier_sum === null) return null

  const { score, modifierSum, steps } = finalizeScore({
    modifierSum: entry.modifier_sum,
    hasTransFat: entry.has_trans_fat ?? false,
    wholePlantOnly: entry.whole_plant_only ?? false,
    proxyUltraProcessed: entry.proxy_ultra_processed ?? false,
    proxyUnidentifiedFat: entry.proxy_unidentified_fat ?? false,
  })

  return (
    <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
      <summary className="tap cursor-pointer text-xs font-semibold text-slate-600">
        Cómo se llegó a este número
      </summary>
      <dl className="mt-2 space-y-1 text-xs text-slate-600">
        <div className="flex items-baseline gap-2">
          <dt className="flex-1">Suma de los modificadores del plato</dt>
          <dd className="font-mono font-semibold tabular-nums">{formatScore(modifierSum)}</dd>
        </div>
        {steps.length === 0 ? (
          // Otherwise the sum and the score are the same number twice over, with
          // nothing saying why -- which reads as a bug rather than as "nothing
          // further applied".
          <div>
            <dt className="text-slate-500">Ninguna de las cuatro reglas finales lo modificó</dt>
          </div>
        ) : (
          steps.map((step) => (
            <div key={step.rule} className="flex items-baseline gap-2">
              <dt className="flex-1">{RULE_COPY[step.rule]}</dt>
              <dd className="font-mono tabular-nums">
                {step.from === step.to ? '—' : formatScore(step.to)}
              </dd>
            </div>
          ))
        )}
        <div className="flex items-baseline gap-2 border-t border-slate-200 pt-1 font-semibold text-slate-900">
          <dt className="flex-1">Puntaje</dt>
          <dd className="font-mono tabular-nums">{formatScore(score)}</dd>
        </div>
      </dl>
    </details>
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
