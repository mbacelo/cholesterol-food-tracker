/**
 * The final score is decided HERE, not by the model (tech spec §7).
 *
 * The model proposes: it returns the raw arithmetic it performed (`modifierSum`,
 * deliberately unclamped) plus four booleans describing which special cases
 * apply. This module re-applies the four post-rules of functional spec §4.2 in
 * our own code and produces the integer that gets stored. That is what makes
 * "the trans-fat cap and the whole-plant floor hold even when the model's own
 * score disagrees" true by construction rather than by trusting the model.
 *
 * PURE: no I/O, no clock, no network, no environment access.
 */

/** The parts of an analysis this module needs. Everything else is display copy. */
export interface ScoreInputs {
  /**
   * The model's running total after applying every modifier in functional spec
   * §4.2, with BOTH proxy penalties counted at their full -1 each and NONE of
   * the four post-rules applied. May legitimately fall outside -5..+5.
   */
  modifierSum: number
  /** Functional spec §4.2 N1: industrial trans fat / partially hydrogenated oil. */
  hasTransFat: boolean
  /** Built only on vegetables, fruit, legumes or whole grains, no added saturated fat. */
  wholePlantOnly: boolean
  /** Proxy penalty N9: ultra-processed convenience product. */
  proxyUltraProcessed: boolean
  /** Proxy penalty N10: bought food whose cooking fat cannot be identified. */
  proxyUnidentifiedFat: boolean
}

export const MIN_SCORE = -5
export const MAX_SCORE = 5

/** Functional spec §4.2 rule 2. */
export const TRANS_FAT_CAP = -2
/** Functional spec §4.2 rule 3. */
export const WHOLE_PLANT_FLOOR = 1

export type ScoreRule =
  | 'proxy_cap'
  | 'trans_fat_cap'
  | 'whole_plant_floor'
  | 'whole_plant_floor_suppressed'
  | 'clamp'

export interface ScoreStep {
  rule: ScoreRule
  /** Value before this rule was applied. */
  from: number
  /** Value after this rule was applied. Equal to `from` for a suppressed rule. */
  to: number
  why: string
}

export interface ScoreBreakdown {
  /** The stored score. Always an integer in -5..+5. */
  score: number
  /** The unclamped starting point, echoed back for logging and tests. */
  modifierSum: number
  /** Every rule that changed (or was deliberately suppressed on) this score, in order. */
  steps: ScoreStep[]
  /**
   * True when the model claimed a dish is both whole-plant-only and contains
   * industrial trans fat. Those cannot both hold, so the cap wins and this flag
   * is raised for logging: a rising rate means the scoring prompt needs work.
   */
  contradiction: boolean
}

/**
 * Applies functional spec §4.2's four post-rules, in the order the spec lists
 * them, and returns the integer to store.
 *
 * 1. The two proxy penalties contribute at most -1 in total. They stand in for
 *    the same unknown -- "we cannot see how this was cooked" -- so letting them
 *    stack would turn one uncertainty into a verdict of its own. The model
 *    reports both at full value, so when both fired we add one point back.
 * 2. Industrial trans fat caps the score at -2.
 * 3. A dish built only on plants with no added saturated fat scores at least +1.
 * 4. Clamp to -5..+5.
 *
 * Rules 2 and 3 can only collide on a contradictory analysis. The cap wins:
 * trans fat is the stronger and more specific signal, and a floor that could
 * lift a trans-fat dish to +1 would break an acceptance criterion.
 */
export function finalizeScore(inputs: ScoreInputs): ScoreBreakdown {
  const steps: ScoreStep[] = []
  const modifierSum = Math.round(inputs.modifierSum)
  let score = modifierSum

  // Rule 1 -- proxy cap.
  if (inputs.proxyUltraProcessed && inputs.proxyUnidentifiedFat) {
    const from = score
    score += 1
    steps.push({
      rule: 'proxy_cap',
      from,
      to: score,
      why: 'both proxy penalties applied; they stand in for the same unknown and are capped at -1 combined',
    })
  }

  // Rule 2 -- trans-fat cap.
  if (inputs.hasTransFat && score > TRANS_FAT_CAP) {
    const from = score
    score = TRANS_FAT_CAP
    steps.push({
      rule: 'trans_fat_cap',
      from,
      to: score,
      why: 'industrial trans fat caps the score at -2',
    })
  }

  // Rule 3 -- whole-plant floor, suppressed by a trans-fat contradiction.
  const contradiction = inputs.wholePlantOnly && inputs.hasTransFat
  if (inputs.wholePlantOnly) {
    if (contradiction) {
      steps.push({
        rule: 'whole_plant_floor_suppressed',
        from: score,
        to: score,
        why: 'analysis claims both whole-plant-only and industrial trans fat; the cap takes precedence',
      })
    } else if (score < WHOLE_PLANT_FLOOR) {
      const from = score
      score = WHOLE_PLANT_FLOOR
      steps.push({
        rule: 'whole_plant_floor',
        from,
        to: score,
        why: 'built only on plants with no added saturated fat, so it scores at least +1',
      })
    }
  }

  // Rule 4 -- clamp.
  if (score < MIN_SCORE || score > MAX_SCORE) {
    const from = score
    score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score))
    steps.push({
      rule: 'clamp',
      from,
      to: score,
      why: `clamped into ${MIN_SCORE}..${MAX_SCORE}`,
    })
  }

  return { score, modifierSum, steps, contradiction }
}

/** True when `value` is an integer within the storable score range. */
export function isValidScore(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE
}
