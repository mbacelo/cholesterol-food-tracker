import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { History as HistoryIcon, Search, X } from 'lucide-react'
import { ScreenHeader } from '@/components/shell'
import { EmptyState, ErrorState, SkeletonList, Spinner } from '@/components/ui'
import { DayHeader, EntryRow } from '@/components/score'
import { useReadySession } from '@/context/SessionContext'
import { apiFetch, errorMessage } from '@/utils/api'
import { dayStatus } from '@/domain/aggregation'
import type { DayMeta, EntriesPage, Entry } from '@/types/api'

const PAGE_SIZE = 30

/** Reverse-chronological, grouped by day, with search and infinite scroll (§6.6). */
export default function History() {
  const { settings } = useReadySession()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''

  const [input, setInput] = useState(query)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [dayMeta, setDayMeta] = useState<Record<string, DayMeta>>({})
  const [cursor, setCursor] = useState<EntriesPage['cursor']>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  // Mirror the search box into the URL, so back and refresh preserve it.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params)
      if (input.trim()) next.set('q', input.trim())
      else next.delete('q')
      setParams(next, { replace: true })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input])

  const loadPage = useCallback(
    async (next: EntriesPage['cursor'], replace: boolean) => {
      setError(null)
      const search = query ? `&q=${encodeURIComponent(query)}` : ''
      const after = next ? `&cursor_date=${next.entry_date}&cursor_created_at=${encodeURIComponent(next.created_at)}` : ''
      try {
        const page = await apiFetch<EntriesPage>(`/api/entries?limit=${PAGE_SIZE}${search}${after}`)
        setEntries((current) => (replace || current === null ? page.entries : [...current, ...page.entries]))
        setDayMeta((current) => (replace ? page.day_meta : { ...current, ...page.day_meta }))
        setCursor(page.cursor)
      } catch (err) {
        setError(errorMessage(err))
      }
    },
    [query],
  )

  useEffect(() => {
    setEntries(null)
    setCursor(null)
    void loadPage(null, true)
  }, [loadPage])

  useEffect(() => {
    const node = sentinel.current
    if (!node || cursor === null) return
    const observer = new IntersectionObserver(
      (items) => {
        if (items[0]?.isIntersecting && !loadingMore) {
          setLoadingMore(true)
          void loadPage(cursor, false).finally(() => setLoadingMore(false))
        }
      },
      { rootMargin: '400px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, loadPage, loadingMore])

  // Group consecutive entries by date. The server already returns them in
  // reverse-chronological order, so no re-sorting is needed.
  const groups: { date: string; items: Entry[] }[] = []
  for (const entry of entries ?? []) {
    const last = groups.at(-1)
    if (last && last.date === entry.entry_date) last.items.push(entry)
    else groups.push({ date: entry.entry_date, items: [entry] })
  }

  const searching = query.length > 0

  return (
    <>
      <ScreenHeader title="History" />

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search descriptions"
          aria-label="Search descriptions"
          className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-9"
        />
        {input ? (
          <button
            type="button"
            onClick={() => setInput('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-slate-500"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {searching && entries !== null ? (
        <p className="mt-2 text-sm text-slate-600">
          {entries.length} {entries.length === 1 ? 'entry matches' : 'entries match'} “{query}”
        </p>
      ) : null}

      {error && entries === null ? (
        <ErrorState message={error} onRetry={() => void loadPage(null, true)} />
      ) : null}

      {entries === null && !error ? <SkeletonList rows={4} /> : null}

      {entries !== null && entries.length === 0 && !error ? (
        <EmptyState
          icon={<HistoryIcon className="size-10" />}
          title={searching ? `No entries match “${query}”` : 'Your history is empty'}
          body={searching ? undefined : 'Logged dishes appear here, newest first.'}
        />
      ) : null}

      <div className="mt-3 space-y-4">
        {groups.map((group) => {
          const meta = dayMeta[group.date]
          const status =
            meta !== undefined
              ? dayStatus(meta.count, meta.average, {
                  target: settings.daily_average_target,
                  minEntriesForValidDay: settings.min_entries_for_valid_day,
                })
              : undefined
          return (
            <section key={group.date}>
              <DayHeader
                date={group.date}
                // In search mode the visible entries are a subset, so the count
                // shown is the match count and the average is hidden.
                count={searching ? group.items.length : (meta?.count ?? group.items.length)}
                average={searching ? undefined : meta?.average}
                {...(status && !searching ? { status } : {})}
                searchMode={searching}
              />
              <ul className="space-y-2">
                {group.items.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <div ref={sentinel} className="h-8" />
      {loadingMore ? (
        <p className="flex justify-center py-2">
          <Spinner label="Loading more" />
        </p>
      ) : null}
      {error && entries !== null ? (
        <button
          type="button"
          onClick={() => void loadPage(cursor, false)}
          className="tap w-full rounded-lg text-sm font-semibold text-slate-600"
        >
          Could not load more · Retry
        </button>
      ) : null}
    </>
  )
}
