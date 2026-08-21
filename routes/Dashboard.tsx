import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AlertCircle, CheckCircle2, LineChart as LineChartIcon } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { HARMFUL_SCORE } from '@/domain/scoring'
import { ScreenHeader } from '@/components/shell'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { ScoreAverage } from '@/components/score'
import { apiFetch, errorMessage } from '@/utils/api'
import { formatAverage, formatScore, scoreHex } from '@/utils/scoreColor'
import { formatDayLabel } from '@/utils/localDate'
import type { SummaryResponse } from '@/types/api'

const PERIODS = [7, 30, 90] as const
/** Below these, a chart says so rather than drawing an empty axis. */
const MIN_TREND_DAYS = 3
const MIN_DISTRIBUTION_ENTRIES = 5

/** Answers one question first: am I meeting my goal? (functional spec §6.7) */
export default function Dashboard() {
  const [params, setParams] = useSearchParams()
  const days = (Number(params.get('days')) || 30) as (typeof PERIODS)[number]
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setSummary(null)
    try {
      setSummary(await apiFetch<SummaryResponse>(`/api/summary?days=${days}`))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  const loggedDays = summary?.trend.filter((point) => point.average !== null).length ?? 0
  const totalEntries = summary?.distribution.reduce((sum, bucket) => sum + bucket.count, 0) ?? 0
  /**
   * Dishes at -3 or worse, which the daily average is structurally bad at showing.
   *
   * The goal is a MEAN, so a +5 salad cancels a -5 asado -- but saturated fat does
   * not average out, and logging an extra good dish lifts the mean without
   * changing anything that was actually eaten badly. This counts the dishes that
   * drive LDL, straight out of the distribution the chart below already uses: no
   * extra request, no new figure to keep consistent.
   */
  const worstCount =
    summary?.distribution
      .filter((bucket) => bucket.score <= HARMFUL_SCORE)
      .reduce((sum, bucket) => sum + bucket.count, 0) ?? 0

  return (
    <>
      <ScreenHeader title="Panel" />

      <div role="radiogroup" aria-label="Período" className="flex gap-1 rounded-lg bg-slate-200 p-1">
        {PERIODS.map((period) => (
          <button
            key={period}
            type="button"
            role="radio"
            aria-checked={days === period}
            onClick={() => {
              const next = new URLSearchParams(params)
              next.set('days', String(period))
              setParams(next, { replace: true })
            }}
            className={`tap flex-1 rounded-md text-sm font-semibold ${
              days === period ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {period} días
          </button>
        ))}
      </div>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {summary === null && !error ? (
        <div className="mt-4 space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : null}

      {summary ? (
        <>
          <section aria-label="Objetivo" className="mt-4 rounded-card bg-white p-4">
            <div className="flex items-baseline gap-3">
              <ScoreAverage average={summary.period.average} />
              <p className="text-sm text-slate-600">objetivo {formatAverage(summary.target)}</p>
            </div>

            {summary.period.meetsTarget === null ? (
              <p className="mt-3 text-sm text-slate-500">
                {summary.period.loggedDays === 0
                  ? `Sin registros en los últimos ${days} días.`
                  : `Todavía no hay días completos — un día necesita ${summary.min_entries_for_valid_day} registros para contar.`}
              </p>
            ) : (
              <p
                className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ${
                  summary.period.meetsTarget
                    ? 'bg-score-p3-soft text-score-p3-ink'
                    : 'bg-score-m3-soft text-score-m3-ink'
                }`}
              >
                {summary.period.meetsTarget ? (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                ) : (
                  <AlertCircle className="size-4" aria-hidden="true" />
                )}
                {summary.period.meetsTarget ? 'Cumpliendo tu objetivo' : 'Por debajo de tu objetivo'}
              </p>
            )}

            <p className="mt-3 text-sm text-slate-700">
              <strong className="font-semibold">
                {summary.period.daysOnTarget} de {summary.period.completeDays}
              </strong>{' '}
              días completos alcanzaron tu objetivo.
            </p>
            {worstCount > 0 ? (
              <p className="mt-1 text-sm text-slate-700">
                <strong className="font-semibold">{worstCount}</strong>{' '}
                {worstCount === 1 ? 'plato' : 'platos'} de −3 o peor{' '}
                {worstCount === 1 ? 'entró' : 'entraron'} en este período.
              </p>
            ) : null}
            {summary.period.incompleteDays > 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                {summary.period.incompleteDays}{' '}
                {summary.period.incompleteDays === 1 ? 'día tuvo' : 'días tuvieron'} menos de{' '}
                {summary.min_entries_for_valid_day} registros y{' '}
                {summary.period.incompleteDays === 1 ? 'se cuenta' : 'se cuentan'} como incompletos.
              </p>
            ) : null}
          </section>

          <ChartCard
            title="Puntaje a lo largo del tiempo"
            summary={`Promedio diario de los últimos ${days} días. Promedio del período ${formatAverage(
              summary.period.average,
            )}, objetivo ${formatAverage(summary.target)}.`}
          >
            {loggedDays < MIN_TREND_DAYS ? (
              <ThinData
                message={`Registra en ${MIN_TREND_DAYS} días distintos y tu tendencia aparecerá aquí (llevas ${loggedDays}).`}
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={summary.trend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5).replace('-', '/')}
                    interval="preserveStartEnd"
                    minTickGap={24}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    domain={[-5, 5]}
                    ticks={[-5, -2.5, 0, 2.5, 5]}
                    width={30}
                    tick={{ fontSize: 11 }}
                  />
                  <ReferenceLine y={summary.target} stroke="#475569" strokeDasharray="4 4">
                    <Label
                      value={`objetivo ${formatAverage(summary.target)}`}
                      position="insideTopRight"
                      fontSize={10}
                      fill="#475569"
                    />
                  </ReferenceLine>
                  <Tooltip
                    formatter={(value) => [formatAverage(typeof value === 'number' ? value : null), 'promedio']}
                    labelFormatter={(label) => formatDayLabel(String(label))}
                  />
                  {/* connectNulls=false so unlogged days render as GAPS. A
                      connected line would invent data that was never logged. */}
                  <Line
                    type="monotone"
                    dataKey="average"
                    connectNulls={false}
                    stroke={scoreHex(summary.period.average ?? 0).mark}
                    strokeWidth={2}
                    dot={summary.trend.length <= 14}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Distribución de puntajes"
            summary={`Cuántos platos cayeron en cada puntaje de -5 a +5. ${totalEntries} en total.`}
          >
            {totalEntries < MIN_DISTRIBUTION_ENTRIES ? (
              <ThinData
                message={`Registra ${MIN_DISTRIBUTION_ENTRIES} platos y la distribución aparecerá aquí (llevas ${totalEntries}).`}
              />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={summary.distribution}
                  margin={{ top: 8, right: 12, bottom: 0, left: -22 }}
                  barCategoryGap="12%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="score" tickFormatter={formatScore} tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} width={26} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value) => [String(value ?? 0), 'platos']}
                    labelFormatter={(label) => `puntaje ${formatScore(Number(label))}`}
                  />
                  <Bar dataKey="count">
                    {/* Per-bar colours are the point: each bar carries its own
                        score's meaning. */}
                    {summary.distribution.map((bucket) => (
                      <Cell key={bucket.score} fill={scoreHex(bucket.score).mark} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </>
      ) : null}
    </>
  )
}

/**
 * Wraps a chart with a screen-reader summary, so the headline figures are not
 * sight-only. Recharts renders an SVG with no accessible structure of its own,
 * so the `sr-only` sentence carries the period average and the target.
 */
function ChartCard({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="mt-4 overflow-hidden rounded-card bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <p className="sr-only">{summary}</p>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </section>
  )
}

function ThinData({ message }: { message: string }) {
  return (
    <EmptyState
      icon={<LineChartIcon className="size-8" />}
      title="Sigue registrando para ver tendencias"
      body={message}
      action={
        <Link
          to="/log"
          className="tap flex w-full items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white"
        >
          Registrar un plato
        </Link>
      }
    />
  )
}
