import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { AlertCircle, Camera, CheckCircle2, CircleDashed } from 'lucide-react'
import { ScreenHeader } from '@/components/shell'
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui'
import { EntryRow, ScoreAverage } from '@/components/score'
import { useReadySession } from '@/context/SessionContext'
import { apiFetch, errorMessage } from '@/utils/api'
import { formatAverage, formatScore } from '@/utils/scoreColor'
import { formatFullDate, todayLocal } from '@/utils/localDate'
import { dailyAverage, dayStatus } from '@/domain/aggregation'
import type { Entry } from '@/types/api'

/** The default landing screen (functional spec §6.5). */
export default function Today() {
  const { settings } = useReadySession()
  const location = useLocation()
  const savedEntryId = (location.state as { savedEntryId?: string } | null)?.savedEntryId

  const [today, setToday] = useState(todayLocal())
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (date: string) => {
    setError(null)
    try {
      const result = await apiFetch<{ entries: Entry[] }>(`/api/entries?date=${date}`)
      setEntries(result.entries)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load(today)
  }, [load, today])

  // A phone left open overnight must not keep showing yesterday under the
  // heading "Today".
  useEffect(() => {
    const check = () => setToday(todayLocal())
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  const average = entries ? dailyAverage(entries.map((entry) => entry.score)) : null
  const status =
    entries && entries.length > 0 && average !== null
      ? dayStatus(entries.length, average, {
          target: settings.daily_average_target,
          minEntriesForValidDay: settings.min_entries_for_valid_day,
        })
      : null

  return (
    <>
      <ScreenHeader title="Today" subtitle={formatFullDate(today)} />

      <section aria-label="Daily average" className="rounded-card bg-white p-4">
        {entries === null ? (
          <div className="h-20" />
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <ScoreAverage average={average} />
              <div className="text-sm text-slate-600">
                <p>
                  {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                </p>
                <p>target {formatAverage(settings.daily_average_target)}</p>
              </div>
            </div>
            {status ? <GoalState status={status} settings={settings} count={entries.length} /> : null}
          </>
        )}
      </section>

      {error ? <ErrorState message={error} onRetry={() => void load(today)} /> : null}

      {entries === null && !error ? <SkeletonList rows={3} /> : null}

      {entries !== null && entries.length === 0 && !error ? (
        <EmptyState
          icon={<Camera className="size-10" />}
          title="Nothing logged today"
          body="Log a dish and you will see how it affects your average."
          action={
            <Link
              to="/log"
              className="tap flex w-full items-center justify-center rounded-lg bg-slate-900 font-semibold text-white"
            >
              Log your first dish
            </Link>
          }
        />
      ) : null}

      {entries !== null && entries.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} highlight={entry.id === savedEntryId} />
          ))}
        </ul>
      ) : null}
    </>
  )
}

function GoalState({
  status,
  settings,
  count,
}: {
  status: 'pass' | 'miss' | 'incomplete'
  settings: { daily_average_target: number; min_entries_for_valid_day: number }
  count: number
}) {
  // An incomplete day is labelled as such rather than shown as pass or fail, so
  // one logged snack cannot read as a failure.
  if (status === 'incomplete') {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-slate-500">
        <CircleDashed className="size-4" aria-hidden="true" />
        Incomplete day — {count} of {settings.min_entries_for_valid_day} entries
      </p>
    )
  }
  if (status === 'pass') {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-score-p3-ink">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        On target ({formatScore(settings.daily_average_target)} or better)
      </p>
    )
  }
  return (
    <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-score-m3-ink">
      <AlertCircle className="size-4" aria-hidden="true" />
      Below target
    </p>
  )
}
