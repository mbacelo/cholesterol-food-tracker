import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { BookOpen, Download, LogOut, Minus, Plus, ShieldCheck } from 'lucide-react'
import { ScreenHeader } from '@/components/shell'
import { ScoreBadge } from '@/components/score'
import { useSession, useReadySession } from '@/context/SessionContext'
import { errorMessage } from '@/utils/api'
import { formatAverage } from '@/utils/scoreColor'
import { todayLocal, tzOffsetMinutes } from '@/utils/localDate'

const TARGET_MIN = -2
const TARGET_MAX = 5
const TARGET_STEP = 0.5

/** Goal, rubric reference, export, log out (functional spec §6.8). */
export default function Me() {
  const { user, settings, isAdmin } = useReadySession()
  const { updateSettings, signOut } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [exporting, setExporting] = useState(false)

  const change = useCallback(
    async (patch: Partial<typeof settings>) => {
      setError(null)
      try {
        await updateSettings(patch)
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
      } catch (err) {
        setError(errorMessage(err))
      }
    },
    [updateSettings],
  )

  /**
   * Fetched rather than a plain link: a bare <a> cannot show progress or handle a
   * 401, and inside an installed PWA a failure would just open a blank tab.
   */
  const download = useCallback(async () => {
    setExporting(true)
    setError(null)
    try {
      const response = await fetch(`/api/export?tz_offset_minutes=${tzOffsetMinutes()}`, {
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `food-entries-${todayLocal()}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not export right now. Try again.')
    } finally {
      setExporting(false)
    }
  }, [])

  const target = settings.daily_average_target

  return (
    <>
      <ScreenHeader title="Me" subtitle={user.email} />

      <section aria-label="Goal" className="mt-2 rounded-card bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Daily average target</h2>
        <p className="mt-1 text-xs text-slate-600">
          Your daily average should be at or above {formatAverage(target)}.
        </p>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            aria-label="Lower target"
            disabled={target <= TARGET_MIN}
            onClick={() => void change({ daily_average_target: target - TARGET_STEP })}
            className="tap grid place-items-center rounded-lg border border-slate-300 disabled:opacity-40"
          >
            <Minus className="size-4" aria-hidden="true" />
          </button>
          <input
            type="range"
            min={TARGET_MIN}
            max={TARGET_MAX}
            step={TARGET_STEP}
            value={target}
            aria-label="Daily average target"
            onChange={(event) =>
              void change({ daily_average_target: Number(event.target.value) })
            }
            className="flex-1"
          />
          <button
            type="button"
            aria-label="Raise target"
            disabled={target >= TARGET_MAX}
            onClick={() => void change({ daily_average_target: target + TARGET_STEP })}
            className="tap grid place-items-center rounded-lg border border-slate-300 disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
          <ScoreBadge score={target} size="md" />
        </div>
      </section>

      <section aria-label="Valid day" className="mt-3 rounded-card bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Entries for a complete day</h2>
        <p className="mt-1 text-xs text-slate-600">
          Days with fewer than {settings.min_entries_for_valid_day} entries are shown as incomplete
          instead of pass or fail.
        </p>
        <div className="mt-3 flex gap-1 rounded-lg bg-slate-100 p-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={settings.min_entries_for_valid_day === value}
              onClick={() => void change({ min_entries_for_valid_day: value })}
              className={`tap flex-1 rounded-md text-sm font-semibold ${
                settings.min_entries_for_valid_day === value
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </section>

      <p aria-live="polite" className="mt-2 h-4 text-xs text-slate-500">
        {saved ? 'Saved' : ''}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <nav aria-label="More" className="mt-3 space-y-2">
        <Link
          to="/rubric"
          className="tap flex w-full items-center gap-3 rounded-card bg-white px-4 text-sm font-medium text-slate-900"
        >
          <BookOpen className="size-5 text-slate-400" aria-hidden="true" />
          How scores are decided
        </Link>

        <button
          type="button"
          onClick={() => void download()}
          disabled={exporting}
          className="tap flex w-full items-center gap-3 rounded-card bg-white px-4 text-left text-sm font-medium text-slate-900 disabled:opacity-60"
        >
          <Download className="size-5 text-slate-400" aria-hidden="true" />
          {exporting ? 'Preparing CSV…' : 'Export all entries (CSV)'}
        </button>

        {isAdmin ? (
          <Link
            to="/admin"
            className="tap flex w-full items-center gap-3 rounded-card bg-white px-4 text-sm font-medium text-slate-900"
          >
            <ShieldCheck className="size-5 text-slate-400" aria-hidden="true" />
            <span className="flex-1">
              Administration
              <span className="block text-xs font-normal text-slate-500">
                Users and prompts · no food data
              </span>
            </span>
          </Link>
        ) : null}

        <button
          type="button"
          onClick={() => void signOut()}
          className="tap flex w-full items-center gap-3 rounded-card bg-white px-4 text-left text-sm font-medium text-slate-900"
        >
          <LogOut className="size-5 text-slate-400" aria-hidden="true" />
          Log out
        </button>
      </nav>
    </>
  )
}
