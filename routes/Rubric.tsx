import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { ScoreBadge } from '@/components/score'

/**
 * The rubric as a reference page (functional spec §6.8), so the user understands
 * how scores are produced and why they cannot be edited.
 *
 * Static copy of the v1 rubric rather than a render of the live scoring_prompt: a
 * raw prompt is not user-facing content, and an administrator may have tuned it.
 * The note at the bottom says so rather than pretending otherwise.
 */

const SCALE = [
  { range: '+4 to +5', meaning: 'Actively lowers LDL. Built on soluble fiber, plant protein or unsaturated fat, essentially no saturated fat.', score: 5 },
  { range: '+1 to +3', meaning: 'Neutral to beneficial. A sound everyday choice.', score: 2 },
  { range: '0', meaning: 'No meaningful effect either way.', score: 0 },
  { range: '-1 to -3', meaning: 'Raises LDL. Acceptable occasionally, not routinely.', score: -2 },
  { range: '-4 to -5', meaning: 'Strongly raises LDL. Built on saturated or trans fat.', score: -5 },
]

const NEGATIVE = [
  ['Partially hydrogenated oil or industrial trans fat', '-3'],
  ['A major saturated fat source is the base of the dish', '-3'],
  ['A saturated fat source is present but secondary', '-2'],
  ['Processed meat', '-2'],
  ['Deep fried, or fried in abundant fat', '-2'],
  ['Refined grains are the dominant carbohydrate', '-1'],
  ['Added sugar', '-1'],
  ['Ultra-processed convenience product', '-1'],
  ['Bought food whose cooking fat cannot be identified', '-1'],
]

const POSITIVE = [
  ['Strong soluble fiber source (oats, legumes, psyllium)', '+2'],
  ['The primary fat is unsaturated (olive oil, avocado, nuts)', '+2'],
  ['Fatty fish rich in omega-3', '+1'],
  ['Moderate soluble fiber source (apple, carrot, flaxseed)', '+1'],
  ['Soy protein is a main component', '+1'],
  ['Nuts or seeds are a real component, not a garnish', '+1'],
  ['Whole grains are the dominant carbohydrate', '+1'],
  ['Vegetables or fruit are a substantial part of the dish', '+1'],
  ['Plant sterol or stanol fortified product', '+1'],
  ['The main protein is lean', '+1'],
]

export default function Rubric() {
  return (
    <>
      <header className="flex items-center gap-2 py-3">
        <Link to="/me" aria-label="Back" className="tap grid place-items-center rounded-lg text-slate-600">
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900">How scores are decided</h1>
      </header>

      <p className="text-sm text-slate-700">
        Every dish gets one integer from −5 to +5 for its expected effect on LDL cholesterol.
        Quantity is ignored: an ingredient counts if it is part of the dish.
      </p>

      <section aria-label="Scale" className="mt-5">
        <h2 className="text-sm font-semibold text-slate-900">The scale</h2>
        <ul className="mt-2 space-y-2">
          {SCALE.map((row) => (
            <li key={row.range} className="flex items-start gap-3 rounded-card bg-white p-3">
              <ScoreBadge score={row.score} size="sm" />
              <div>
                <p className="text-sm font-semibold text-slate-900">{row.range}</p>
                <p className="text-sm text-slate-600">{row.meaning}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <ModifierTable title="What lowers a score" rows={NEGATIVE} kind="negative" />
      <ModifierTable title="What raises a score" rows={POSITIVE} kind="positive" />

      <section aria-label="Rules" className="mt-5 rounded-card bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Rules applied to the result</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>The two &ldquo;cannot tell&rdquo; penalties count at most −1 in total.</li>
          <li>If the dish contains industrial trans fat, the score is capped at −2.</li>
          <li>
            A dish built only on vegetables, fruit, legumes or whole grains, with no added
            saturated fat, scores at least +1.
          </li>
          <li>The result is clamped to −5..+5.</li>
        </ol>
      </section>

      <section aria-label="Not penalized" className="mt-5 rounded-card bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Deliberately not penalized</h2>
        <p className="mt-2 text-sm text-slate-700">
          Dietary cholesterol as a general category, and shellfish specifically. Saturated and
          trans fat are the dominant dietary drivers of LDL, and lean shellfish counts here as a
          lean protein.
        </p>
      </section>

      <section className="mt-5 rounded-card border border-slate-300 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">
          You describe the food; the app decides the score.
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Scores and explanations cannot be edited — a record you can adjust after the fact is not
          worth keeping. If a score looks wrong, correct the description and it will be scored
          again. Your administrator may have tuned this rubric.
        </p>
      </section>
    </>
  )
}

function ModifierTable({
  title,
  rows,
  kind,
}: {
  title: string
  rows: string[][]
  kind: 'positive' | 'negative'
}) {
  return (
    <section aria-label={title} className="mt-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <ul className="mt-2 space-y-1.5">
        {rows.map(([label, modifier]) => (
          <li
            key={label}
            className={`flex items-baseline gap-3 rounded-lg px-3 py-2 text-sm ${
              kind === 'positive'
                ? 'bg-score-p2-soft text-score-p2-ink'
                : 'bg-score-m3-soft text-score-m3-ink'
            }`}
          >
            <span className="w-8 shrink-0 font-mono font-semibold">{modifier}</span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
