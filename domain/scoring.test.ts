import { describe, expect, it } from 'vitest'
import { MAX_SCORE, MIN_SCORE, finalizeScore, isValidScore, type ScoreInputs } from './scoring'

/** A neutral analysis. Each test overrides only what it is about. */
function inputs(over: Partial<ScoreInputs> = {}): ScoreInputs {
  return {
    modifierSum: 0,
    hasTransFat: false,
    wholePlantOnly: false,
    proxyUltraProcessed: false,
    proxyUnidentifiedFat: false,
    ...over,
  }
}

const rules = (result: ReturnType<typeof finalizeScore>) => result.steps.map((step) => step.rule)

describe('business rule 4: the score is always a single integer in -5..+5', () => {
  it.each([-40, -6, -5, 0, 5, 6, 40])('clamps a modifier sum of %i into range', (sum) => {
    const { score } = finalizeScore(inputs({ modifierSum: sum }))
    expect(isValidScore(score)).toBe(true)
  })

  it('passes an in-range sum through untouched', () => {
    const result = finalizeScore(inputs({ modifierSum: -3 }))
    expect(result.score).toBe(-3)
    expect(result.steps).toEqual([])
  })

  it('rounds a non-integer modifier sum rather than storing a fraction', () => {
    expect(finalizeScore(inputs({ modifierSum: 2.4 })).score).toBe(2)
    expect(finalizeScore(inputs({ modifierSum: 2.5 })).score).toBe(3)
  })
})

describe('functional spec §4.2 rule 1: the two proxy penalties cap at -1 combined', () => {
  it('adds a point back when BOTH proxies fired', () => {
    // The model reports both at full -1, so -4 becomes -3.
    const result = finalizeScore(
      inputs({ modifierSum: -4, proxyUltraProcessed: true, proxyUnidentifiedFat: true }),
    )
    expect(result.score).toBe(-3)
    expect(rules(result)).toContain('proxy_cap')
  })

  it.each([
    ['ultra-processed only', { proxyUltraProcessed: true }],
    ['unidentified fat only', { proxyUnidentifiedFat: true }],
    ['neither', {}],
  ])('leaves the sum alone with %s', (_label, over) => {
    const result = finalizeScore(inputs({ modifierSum: -4, ...over }))
    expect(result.score).toBe(-4)
    expect(rules(result)).not.toContain('proxy_cap')
  })

  it('applies before the clamp, so the cap is not lost at the boundary', () => {
    // -6 would clamp straight to -5; the proxy cap must lift it to -5 first,
    // which is only observable because the step list records both rules.
    const result = finalizeScore(
      inputs({ modifierSum: -6, proxyUltraProcessed: true, proxyUnidentifiedFat: true }),
    )
    expect(result.score).toBe(-5)
    expect(rules(result)).toEqual(['proxy_cap'])
  })
})

describe('functional spec §4.2 rule 2: industrial trans fat caps the score at -2', () => {
  it('caps a positive score', () => {
    const result = finalizeScore(inputs({ modifierSum: 4, hasTransFat: true }))
    expect(result.score).toBe(-2)
    expect(rules(result)).toContain('trans_fat_cap')
  })

  it('holds even when the model would have scored the dish well', () => {
    // The acceptance criterion: the cap holds when the model's own number disagrees.
    expect(finalizeScore(inputs({ modifierSum: 5, hasTransFat: true })).score).toBe(-2)
  })

  it('never RAISES an already-worse score', () => {
    const result = finalizeScore(inputs({ modifierSum: -5, hasTransFat: true }))
    expect(result.score).toBe(-5)
    expect(rules(result)).not.toContain('trans_fat_cap')
  })

  it('is a no-op at exactly -2', () => {
    expect(rules(finalizeScore(inputs({ modifierSum: -2, hasTransFat: true })))).toEqual([])
  })
})

describe('functional spec §4.2 rule 3: a whole-plant dish scores at least +1', () => {
  it('lifts a negative sum to +1', () => {
    const result = finalizeScore(inputs({ modifierSum: -2, wholePlantOnly: true }))
    expect(result.score).toBe(1)
    expect(rules(result)).toContain('whole_plant_floor')
  })

  it('never LOWERS a score that already clears the floor', () => {
    const result = finalizeScore(inputs({ modifierSum: 5, wholePlantOnly: true }))
    expect(result.score).toBe(5)
    expect(rules(result)).not.toContain('whole_plant_floor')
  })

  it('is a no-op at exactly +1', () => {
    expect(rules(finalizeScore(inputs({ modifierSum: 1, wholePlantOnly: true })))).toEqual([])
  })
})

describe('rule 2 versus rule 3: the trans-fat cap wins', () => {
  // The two flags cannot both be true of a real dish, and the spec's literal rule
  // order would let the floor undo the cap. Trans fat is the stronger, more
  // specific signal, so the floor is suppressed and the collision is reported.
  const contradictory = inputs({ modifierSum: 3, hasTransFat: true, wholePlantOnly: true })

  it('caps at -2 rather than floating up to +1', () => {
    expect(finalizeScore(contradictory).score).toBe(-2)
  })

  it('records the suppression instead of applying the floor silently', () => {
    expect(rules(finalizeScore(contradictory))).toEqual([
      'trans_fat_cap',
      'whole_plant_floor_suppressed',
    ])
  })

  it('flags the contradiction so a drifting prompt is visible in the logs', () => {
    expect(finalizeScore(contradictory).contradiction).toBe(true)
    expect(finalizeScore(inputs({ wholePlantOnly: true })).contradiction).toBe(false)
    expect(finalizeScore(inputs({ hasTransFat: true })).contradiction).toBe(false)
  })
})

describe('rules are applied in the order functional spec §4.2 lists them', () => {
  it('proxy cap, then trans-fat cap, then floor, then clamp', () => {
    const result = finalizeScore(
      inputs({
        modifierSum: 9,
        proxyUltraProcessed: true,
        proxyUnidentifiedFat: true,
        hasTransFat: true,
      }),
    )
    // +9 -> +10 (proxy cap) -> -2 (trans-fat cap). No clamp needed afterwards.
    expect(rules(result)).toEqual(['proxy_cap', 'trans_fat_cap'])
    expect(result.score).toBe(-2)
  })

  it('echoes the unclamped input back for logging', () => {
    expect(finalizeScore(inputs({ modifierSum: 99 })).modifierSum).toBe(99)
  })
})

describe('isValidScore', () => {
  it('accepts every storable score', () => {
    for (let score = MIN_SCORE; score <= MAX_SCORE; score += 1) {
      expect(isValidScore(score)).toBe(true)
    }
  })

  it('rejects out-of-range and non-integer values', () => {
    expect(isValidScore(6)).toBe(false)
    expect(isValidScore(-6)).toBe(false)
    expect(isValidScore(1.5)).toBe(false)
    expect(isValidScore(Number.NaN)).toBe(false)
  })
})
