import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { HARMFUL_SCORE } from '@/domain/scoring'
import { ScoreBadge } from '@/components/score'
import { NEGATIVE_MODIFIERS, POSITIVE_MODIFIERS, type Modifier } from '@/lib/ai/prompts/defaults'

/**
 * The rubric as a reference page (functional spec §6.8), so the user understands
 * how scores are produced and why they cannot be edited.
 *
 * The modifier tables are rendered from the SAME constant the scoring prompt is
 * built from, not a hand-kept copy. They used to be two independent lists, which
 * meant tuning the prompt silently made this page false -- and this page is the
 * whole argument for "the score is not negotiable".
 *
 * It still shows the DEFAULT rubric rather than the live scoring_prompt: a raw
 * prompt is not user-facing content, and an administrator may have tuned it. The
 * note at the bottom says so rather than pretending otherwise.
 */

/**
 * The negative side breaks at HARMFUL_SCORE, the same line the dashboard draws
 * when it counts "platos de -3 o peor". The two screens used to disagree about
 * whether -3 was acceptable.
 */
const SCALE = [
  { range: '+4 a +5', meaning: 'Baja el LDL activamente. Basado en fibra soluble, proteína vegetal o grasa insaturada, prácticamente sin grasa saturada.', score: 5 },
  { range: '+1 a +3', meaning: 'Favorable al LDL. Una buena opción para todos los días.', score: 2 },
  { range: '0', meaning: 'Sin efecto relevante en ningún sentido.', score: 0 },
  { range: '-1 a -2', meaning: 'Sube algo el LDL. Aceptable de vez en cuando, no a diario.', score: -1 },
  { range: `${HARMFUL_SCORE} a -5`, meaning: 'Sube el LDL de forma importante. Basado en grasa saturada o trans.', score: -5 },
]

export default function Rubric() {
  return (
    <>
      <header className="flex items-center gap-2 py-3">
        <Link to="/me" aria-label="Volver" className="tap grid place-items-center rounded-lg text-slate-600">
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Cómo se decide el puntaje</h1>
      </header>

      <p className="text-sm text-slate-700">
        Cada plato recibe un número entero de −5 a +5 según su efecto esperado sobre el
        colesterol LDL. La cantidad no se tiene en cuenta: un ingrediente cuenta si forma parte
        del plato.
      </p>

      <section aria-label="Escala" className="mt-5">
        <h2 className="text-sm font-semibold text-slate-900">La escala</h2>
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

      <ModifierTable title="Qué baja el puntaje" rows={NEGATIVE_MODIFIERS} kind="negative" />
      <ModifierTable title="Qué sube el puntaje" rows={POSITIVE_MODIFIERS} kind="positive" />

      <section aria-label="Reglas" className="mt-5 rounded-card bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Reglas aplicadas al resultado</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Las dos penalizaciones por &ldquo;no se puede saber&rdquo; suman como máximo −1 en total.</li>
          <li>Si el plato tiene grasa trans industrial, el puntaje no puede superar −2.</li>
          <li>
            Un plato basado solo en verduras, frutas, legumbres o cereales integrales, sin grasa
            saturada añadida, recibe al menos +1.
          </li>
          <li>El resultado se limita al rango −5..+5.</li>
        </ol>
      </section>

      <section aria-label="Sin penalización" className="mt-5 rounded-card bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Deliberadamente sin penalización</h2>
        <p className="mt-2 text-sm text-slate-700">
          El colesterol de la dieta como categoría general: los mariscos, la yema de huevo y las
          vísceras no bajan el puntaje. La grasa saturada y la trans son los principales factores
          dietéticos del LDL. Los mariscos magros cuentan aquí como proteína magra, y de las
          vísceras se puntúa su grasa de cocción, no el órgano.
        </p>
      </section>

      <section className="mt-5 rounded-card border border-slate-300 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">
          Tú describes la comida; la app decide el puntaje.
        </p>
        <p className="mt-1 text-sm text-slate-600">
          El puntaje y su explicación no se pueden editar — un registro que puedes ajustar
          después no vale la pena guardarlo. Si un puntaje parece equivocado, corrige la
          descripción y se volverá a calcular. Tu administrador puede haber ajustado esta rúbrica.
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
  rows: readonly Modifier[]
  kind: 'positive' | 'negative'
}) {
  return (
    <section aria-label={title} className="mt-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <ul className="mt-2 space-y-1.5">
        {rows.map((rule) => (
          <li
            key={rule.code}
            className={`flex items-baseline gap-3 rounded-lg px-3 py-2 text-sm ${
              kind === 'positive'
                ? 'bg-score-p2-soft text-score-p2-ink'
                : 'bg-score-m3-soft text-score-m3-ink'
            }`}
          >
            {/* The signed number the rubric actually adds, straight from the
                table the prompt is built from. */}
            <span className="w-8 shrink-0 font-mono font-semibold">
              {rule.modifier > 0 ? `+${rule.modifier}` : rule.modifier}
            </span>
            <span>{rule.ui}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
