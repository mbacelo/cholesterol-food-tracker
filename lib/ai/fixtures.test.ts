import { beforeAll, describe, expect, it } from 'vitest'
import { analyze } from './analyze'
import { db, resetDb } from '../server/db'
import { resetBursts } from '../server/usage'

/**
 * The scoring regression net (tech spec §7, determinism mechanism 3).
 *
 * Both prompts are administrator-editable CONTENT, and the whole quality of the
 * app rests on them. Everything else in the suite runs against the mock provider,
 * which only proves the plumbing: that a score flows from analysis to stored row.
 * This file is the only thing that answers the question that actually matters
 * after a prompt edit -- does the rubric still score food correctly?
 *
 * Run it after every prompt edit:
 *
 *     RUN_AI_FIXTURES=1 AI_PROVIDER=openai npm test
 *
 * IT COSTS MONEY -- one uncached model call per fixture -- so it is opt-in and
 * skipped by default. `npm test` stays free, offline and credential-less.
 *
 * ## Why bands rather than exact integers
 *
 * Functional spec §6.3 allows the same description to move by one point between
 * scorings, so asserting an exact score would fail on noise rather than on
 * regressions. Each band below is wide enough to absorb that and narrow enough
 * that a genuinely broken rubric cannot pass: the point is that a chivito never
 * reads as healthy and a lentil stew never reads as harmful.
 *
 * The four dishes the scoring prompt works through by hand are included
 * deliberately -- if the prompt's own worked examples stop landing where the
 * prompt says they land, the prompt is broken.
 */

const ENABLED = process.env.RUN_AI_FIXTURES === '1'

const EMAIL = 'fixtures@example.com'
const DAY = '2026-08-19'
/** Well above the fixture count, so the daily cap cannot fail the run. */
const CALL_BUDGET = '500'
/** Generous: an uncached analysis is ~6s at AI_EFFORT=low and ~17s at high. */
const TIMEOUT_MS = 90_000

interface Fixture {
  description: string
  isHomemade: boolean
  /** Inclusive band the final stored score must land in. */
  min: number
  max: number
  /** Why this fixture exists. Printed on failure. */
  because: string
}

const FIXTURES: Fixture[] = [
  // ---- the scoring prompt's own worked examples ---------------------------
  {
    description: 'Tallarines a la carbonara con panceta y crema',
    isHomemade: true,
    min: -5,
    max: -4,
    because: 'the prompt works this through to modifier_sum -6, which clamps to -5',
  },
  {
    description: 'Ensalada de garbanzos con tomate, pepino y aceite de oliva',
    isHomemade: true,
    min: 4,
    max: 5,
    because: 'the prompt works this through to modifier_sum +6, which clamps to +5',
  },
  {
    description: 'Supermarket chicken curry ready meal',
    isHomemade: false,
    min: -5,
    max: -2,
    because: 'both proxy penalties fire; the app caps them at -1 combined',
  },
  {
    description: 'Café con leche entera y tres medialunas',
    isHomemade: false,
    min: -5,
    max: -4,
    because: 'commercial laminated pastry: trans fat plus a butter base, modifier_sum -8',
  },

  // ---- the strongly negative end -----------------------------------------
  {
    description: 'Chivito',
    isHomemade: false,
    min: -5,
    max: -3,
    because: 'the unnamed panceta, jamón, muzzarella and mayonesa must be inferred from the name',
  },
  {
    description: 'Milanesa napolitana',
    isHomemade: false,
    min: -5,
    max: -3,
    because: 'breaded and fried, plus ham and melted cheese the name does not mention',
  },
  {
    description: 'Bandeja paisa',
    isHomemade: false,
    min: -5,
    max: -3,
    because: 'chicharrón, chorizo and fried egg outweigh the beans',
  },
  {
    description: 'Feijoada',
    isHomemade: false,
    min: -5,
    max: -2,
    because: 'cured pork and sausage outweigh the black beans',
  },
  {
    description: 'Asado de tira con chorizo y morcilla',
    isHomemade: false,
    min: -5,
    max: -3,
    because: 'fatty red meat as the base, plus processed meat',
  },
  {
    description: 'Hamburguesa con queso y papas fritas',
    isHomemade: false,
    min: -5,
    max: -3,
    because: 'fast food: saturated fat base, deep fried, refined bun',
  },
  {
    description: 'Empanadas de carne fritas',
    isHomemade: false,
    min: -5,
    max: -3,
    because: 'fried, and the pastry is made with butter, lard or beef fat',
  },
  {
    description: 'Provoleta',
    isHomemade: true,
    min: -4,
    max: -2,
    because: 'grilled full-fat cheese is a saturated fat base with nothing to offset it',
  },
  {
    description: 'Tortilla de papas',
    isHomemade: true,
    min: -3,
    max: 0,
    because: 'abundant frying oil, but nothing worse -- it must not read like a chivito',
  },

  // ---- the strongly positive end -----------------------------------------
  {
    description: 'Lentejas guisadas con verduras y aceite de oliva',
    isHomemade: true,
    min: 4,
    max: 5,
    because: 'soluble fiber, unsaturated primary fat, vegetables, lean plant protein',
  },
  {
    description: 'Avena con manzana y nueces',
    isHomemade: true,
    min: 4,
    max: 5,
    because: 'oats and apple are the textbook soluble-fiber case',
  },
  {
    description: 'Salmón a la parrilla con quinoa y brócoli',
    isHomemade: true,
    min: 3,
    max: 5,
    because: 'fatty fish, whole grain and vegetables, grilled rather than fried',
  },
  {
    description: 'Tofu salteado con verduras y aceite de oliva',
    isHomemade: true,
    min: 3,
    max: 5,
    because: 'soy protein plus an unsaturated primary fat',
  },
  {
    description: 'Porotos granados',
    isHomemade: true,
    min: 2,
    max: 5,
    because: 'a whole-plant legume and squash stew',
  },
  {
    description: 'Guacamole con bastones de zanahoria',
    isHomemade: true,
    min: 2,
    max: 5,
    because: 'avocado is an unsaturated fat, not a fat to punish',
  },

  // ---- the middle, where over-reaction is the failure mode ----------------
  {
    description: 'Pollo a la parrilla, arroz blanco, brócoli al vapor',
    isHomemade: true,
    min: 0,
    max: 3,
    because: 'lean protein and vegetables against one refined grain: mild, not negative',
  },
  {
    description: 'Gallo pinto',
    isHomemade: true,
    min: 0,
    max: 3,
    because: 'black beans carry it despite the white rice',
  },
  {
    description: 'Ceviche',
    isHomemade: false,
    min: 0,
    max: 4,
    because: 'raw white fish and lime: lean, with no cooking fat to be unsure about',
  },
  {
    description: 'Tacos al pastor',
    isHomemade: false,
    min: -3,
    max: 1,
    because: 'pork against a whole-maize tortilla and pineapple: middling, not extreme',
  },
  {
    description: 'Moqueca de peixe',
    isHomemade: false,
    min: -4,
    max: 0,
    because: 'coconut milk and dendê are a saturated fat base even though the fish is lean',
  },
  {
    description: 'Arepa reina pepiada',
    isHomemade: false,
    min: -3,
    max: 2,
    because: 'mayonesa and refined corn flour against avocado and chicken',
  },

  // ---- what the rubric must deliberately NOT punish (STEP 7) --------------
  {
    description: 'Camarones a la plancha con ensalada y aceite de oliva',
    isHomemade: true,
    min: 3,
    max: 5,
    because: 'shellfish is LEAN PROTEIN here, never a negative; dietary cholesterol is not a driver',
  },
  {
    description: 'Huevos revueltos con espinaca y aceite de oliva',
    isHomemade: true,
    min: 1,
    max: 5,
    because: 'there is no egg-yolk penalty; yolk cholesterol is dietary cholesterol',
  },
  {
    description: 'Hígado a la plancha con cebolla',
    isHomemade: true,
    min: -1,
    max: 3,
    because: 'organ meat is lean: score its cooking fat, not the organ',
  },
  {
    description: 'Mejillones al vapor con limón',
    isHomemade: true,
    min: 1,
    max: 5,
    because: 'shellfish again, steamed, with no added fat at all',
  },
]

describe.skipIf(!ENABLED)('scoring fixtures (real model, costs money)', () => {
  beforeAll(async () => {
    delete process.env.VERCEL
    process.env.AI_DAILY_CALL_LIMIT = CALL_BUDGET

    // A mock run would pass even on a rubric that had been deleted entirely,
    // which is the one outcome this suite exists to catch.
    expect(
      process.env.AI_PROVIDER,
      'set AI_PROVIDER to a real provider; the mock proves nothing about the rubric',
    ).not.toBe('mock')

    resetDb()
    // Every fixture must reach the model: a cache hit would assert nothing about
    // the prompt that was just edited.
    await db()`delete from score_cache`
    await db()`delete from ai_usage where email = ${EMAIL}`
    resetBursts()
  }, 60_000)

  it.each(FIXTURES)(
    '$description scores between $min and $max',
    async ({ description, isHomemade, min, max, because }) => {
      // The burst limiter allows 8 a minute and these run back to back.
      resetBursts()

      const result = await analyze({ description, isHomemade, email: EMAIL, localDay: DAY })

      const detail = [
        `${description} (${isHomemade ? 'homemade' : 'bought'}) scored ${result.score}`,
        `expected ${min}..${max} because ${because}`,
        `rationale: ${result.rationale}`,
      ].join('\n  ')

      expect(Number.isInteger(result.score), detail).toBe(true)
      expect(result.score, detail).toBeGreaterThanOrEqual(min)
      expect(result.score, detail).toBeLessThanOrEqual(max)

      // Every score is explained (design principle 2).
      expect(result.rationale.trim().length, detail).toBeGreaterThan(0)
      expect(
        result.positiveFactors.length + result.negativeFactors.length,
        `no factors returned for "${description}"`,
      ).toBeGreaterThan(0)
    },
    TIMEOUT_MS,
  )

  it(
    'scores a typed non-dish as 0 rather than refusing it',
    async () => {
      // Functional spec §6.1: telling someone who just typed to "type a
      // description" would be a loop, so a typed non-dish stays scorable at 0.
      resetBursts()
      const result = await analyze({
        description: 'asdf',
        isHomemade: true,
        email: EMAIL,
        localDay: DAY,
      })
      expect(result.foodDetected).toBe(true)
      expect(result.score).toBe(0)
    },
    TIMEOUT_MS,
  )

  it(
    'never scores a bought dish above the same dish made at home',
    async () => {
      // The homemade flag is context, not a modifier of its own (STEP 5): buying
      // can only add the unidentified-fat assumption, never improve a dish.
      const description = 'Pollo al horno con papas'

      resetBursts()
      const home = await analyze({ description, isHomemade: true, email: EMAIL, localDay: DAY })
      resetBursts()
      const bought = await analyze({ description, isHomemade: false, email: EMAIL, localDay: DAY })

      expect(bought.score, `home ${home.score} vs bought ${bought.score}`).toBeLessThanOrEqual(
        home.score,
      )
    },
    TIMEOUT_MS * 2,
  )
})
