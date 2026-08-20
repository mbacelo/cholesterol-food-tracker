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
  { range: '+4 a +5', meaning: 'Baja el LDL activamente. Basado en fibra soluble, proteína vegetal o grasa insaturada, prácticamente sin grasa saturada.', score: 5 },
  { range: '+1 a +3', meaning: 'De neutro a beneficioso. Una buena opción para todos los días.', score: 2 },
  { range: '0', meaning: 'Sin efecto relevante en ningún sentido.', score: 0 },
  { range: '-1 a -3', meaning: 'Sube el LDL. Aceptable de vez en cuando, no a diario.', score: -2 },
  { range: '-4 a -5', meaning: 'Sube mucho el LDL. Basado en grasa saturada o trans.', score: -5 },
]

const NEGATIVE = [
  ['Aceite parcialmente hidrogenado o grasa trans industrial', '-3'],
  ['Una fuente importante de grasa saturada es la base del plato', '-3'],
  ['Hay una fuente de grasa saturada, pero es secundaria', '-2'],
  ['Carne procesada', '-2'],
  ['Frito por inmersión, o frito en abundante grasa', '-2'],
  ['Los cereales refinados son el carbohidrato dominante', '-1'],
  ['Azúcar añadido', '-1'],
  ['Producto ultraprocesado de conveniencia', '-1'],
  ['Comida comprada cuya grasa de cocción no se puede identificar', '-1'],
]

const POSITIVE = [
  ['Fuente fuerte de fibra soluble (avena, legumbres, psyllium)', '+2'],
  ['La grasa principal es insaturada (aceite de oliva, aguacate, frutos secos)', '+2'],
  ['Pescado graso rico en omega-3', '+1'],
  ['Fuente moderada de fibra soluble (manzana, zanahoria, lino)', '+1'],
  ['La proteína de soja es un componente principal', '+1'],
  ['Frutos secos o semillas son un componente real, no una guarnición', '+1'],
  ['Los cereales integrales son el carbohidrato dominante', '+1'],
  ['Las verduras o frutas son una parte sustancial del plato', '+1'],
  ['Producto fortificado con esteroles o estanoles vegetales', '+1'],
  ['La proteína principal es magra', '+1'],
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

      <ModifierTable title="Qué baja el puntaje" rows={NEGATIVE} kind="negative" />
      <ModifierTable title="Qué sube el puntaje" rows={POSITIVE} kind="positive" />

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
          El colesterol de la dieta como categoría general, y los mariscos en particular. La grasa
          saturada y la trans son los principales factores dietéticos del LDL, y los mariscos
          magros cuentan aquí como proteína magra.
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
