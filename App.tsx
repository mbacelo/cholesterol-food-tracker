import { SCORE_CLASSES, formatScore, scoreKey } from '@/utils/scoreColor'

const SCORES = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]

/**
 * Temporary scaffold screen.
 *
 * It exists to prove the Tailwind v4 setup end to end: every score class is
 * generated in a PRODUCTION build (where an interpolated class name would be
 * purged and render transparent). The real route tree replaces this in the
 * screens step of the build order.
 */
export default function App() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Cholesterol Food Tracker</h1>
      <p className="mt-1 text-sm text-slate-600">
        Scaffold check: the score ramp below must render in colour in a production build.
      </p>

      <section aria-labelledby="ramp" className="mt-6">
        <h2 id="ramp" className="text-sm font-semibold text-slate-700">
          Score ramp
        </h2>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SCORES.map((score) => {
            const c = SCORE_CLASSES[scoreKey(score)]
            return (
              <li
                key={score}
                className={`flex items-center gap-3 rounded-card border p-2 ${c.softBg} ${c.border}`}
              >
                <span
                  className={`tap flex items-center justify-center rounded-lg px-3 font-bold ${c.solidBg} ${c.onSolid}`}
                >
                  {formatScore(score)}
                </span>
                <span className={`text-sm font-semibold ${c.text}`}>{formatScore(score)}</span>
                <span className={`ml-auto h-6 w-6 rounded ${c.mark}`} aria-hidden="true" />
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}
