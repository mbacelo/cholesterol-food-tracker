import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SCORE_CLASSES,
  SCORE_HEX,
  formatAverage,
  formatScore,
  scoreKey,
  type ScoreKey,
} from './scoreColor'

const CSS_PATH = fileURLToPath(new URL('../index.css', import.meta.url))

/** Pulls every --color-score-* declaration out of the @theme block. */
function themeColors(): Record<string, string> {
  const css = readFileSync(CSS_PATH, 'utf8')
  const out: Record<string, string> = {}
  for (const match of css.matchAll(/--color-score-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[match[1]!] = match[2]!.toLowerCase()
  }
  return out
}

const ALL_KEYS: ScoreKey[] = ['m5', 'm4', 'm3', 'm2', 'm1', 'z0', 'p1', 'p2', 'p3', 'p4', 'p5']

describe('the score ramp stays in sync with index.css', () => {
  // SCORE_HEX duplicates the CSS theme because Recharts takes colour values, not
  // class names. This test is what stops the duplication from rotting.
  const theme = themeColors()

  it('defines all 33 score colours in the CSS theme', () => {
    expect(Object.keys(theme)).toHaveLength(ALL_KEYS.length * 3)
  })

  it.each(ALL_KEYS)('%s matches the CSS theme in all three tiers', (key) => {
    expect(SCORE_HEX[key].mark).toBe(theme[key])
    expect(SCORE_HEX[key].ink).toBe(theme[`${key}-ink`])
    expect(SCORE_HEX[key].soft).toBe(theme[`${key}-soft`])
  })
})

describe('score class strings', () => {
  it.each(ALL_KEYS)('%s writes every class out literally, never interpolated', (key) => {
    // A literal-string check: if someone refactors to `bg-score-${key}` the
    // resulting class would be missing its suffix and Tailwind would purge it.
    const classes = SCORE_CLASSES[key]
    expect(classes.mark).toBe(`bg-score-${key}`)
    expect(classes.text).toBe(`text-score-${key}-ink`)
    expect(classes.softBg).toBe(`bg-score-${key}-soft`)
    for (const value of Object.values(classes)) {
      expect(value).not.toContain('${')
      expect(value.endsWith('-')).toBe(false)
    }
  })

  it('never produces a class with a bare leading dash in the token', () => {
    // `bg-score--5` would collide with Tailwind's negative-value syntax, which is
    // why the tokens are named m5..p5 rather than -5..+5.
    for (const key of ALL_KEYS) {
      for (const value of Object.values(SCORE_CLASSES[key])) {
        expect(value).not.toContain('--')
      }
    }
  })
})

describe('scoreKey', () => {
  it('maps each integer score to its own key', () => {
    expect(ALL_KEYS.map((_, i) => scoreKey(i - 5))).toEqual(ALL_KEYS)
  })

  it('rounds fractional averages so they are colourable', () => {
    expect(scoreKey(1.4)).toBe('p1')
    expect(scoreKey(1.5)).toBe('p2')
    expect(scoreKey(-0.4)).toBe('z0')
  })

  it('clamps out-of-range input instead of throwing', () => {
    expect(scoreKey(99)).toBe('p5')
    expect(scoreKey(-99)).toBe('m5')
  })
})

describe('formatScore', () => {
  it('always shows the sign', () => {
    expect(formatScore(3)).toBe('+3')
    expect(formatScore(0)).toBe('0')
    expect(formatScore(-3)).toBe('-3')
  })
})

describe('formatAverage', () => {
  it('renders an em dash for a day with no entries, never a zero', () => {
    // Business rule 8: a date with no entries is "not logged", not a zero.
    expect(formatAverage(null)).toBe('—')
    expect(formatAverage(0)).toBe('0.0')
  })

  it('shows one signed decimal', () => {
    expect(formatAverage(1.25)).toBe('+1.3')
    expect(formatAverage(-2)).toBe('−2.0')
  })
})
