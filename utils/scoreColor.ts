/**
 * The one place that maps a score to a colour (tech spec §8).
 *
 * Every class string below is written out in full, on purpose. Tailwind does not
 * execute or parse JavaScript -- its extractor reads source files as plain text,
 * so a template literal like `bg-score-${key}` produces only the candidate
 * "bg-score-" and the utility is never generated. That failure shows up in
 * production builds only, because a dev build often still carries the class from
 * an earlier literal. A static record of complete strings is the only safe form.
 */

export type ScoreKey = 'm5' | 'm4' | 'm3' | 'm2' | 'm1' | 'z0' | 'p1' | 'p2' | 'p3' | 'p4' | 'p5'

const KEYS: readonly ScoreKey[] = [
  'm5',
  'm4',
  'm3',
  'm2',
  'm1',
  'z0',
  'p1',
  'p2',
  'p3',
  'p4',
  'p5',
]

/** Clamps and rounds, so a fractional daily average is colourable too. */
export function scoreKey(score: number): ScoreKey {
  const index = Math.max(-5, Math.min(5, Math.round(score))) + 5
  return KEYS[index]!
}

export interface ScoreClasses {
  /** Vivid fill: rails, progress bars, chart marks addressed by className. */
  mark: string
  /** Vivid fill for inline SVG. */
  markFill: string
  /** AA-on-white ink: the signed number, icons. */
  text: string
  /** Solid badge. Contrast is symmetric, so ink-as-background under white text is AA too. */
  solidBg: string
  onSolid: string
  /** Soft chip: 50-level tint with ink text on top. */
  softBg: string
  border: string
  ring: string
}

export const SCORE_CLASSES: Record<ScoreKey, ScoreClasses> = {
  m5: {
    mark: 'bg-score-m5',
    markFill: 'fill-score-m5',
    text: 'text-score-m5-ink',
    solidBg: 'bg-score-m5-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-m5-soft',
    border: 'border-score-m5-ink',
    ring: 'ring-score-m5-ink',
  },
  m4: {
    mark: 'bg-score-m4',
    markFill: 'fill-score-m4',
    text: 'text-score-m4-ink',
    solidBg: 'bg-score-m4-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-m4-soft',
    border: 'border-score-m4-ink',
    ring: 'ring-score-m4-ink',
  },
  m3: {
    mark: 'bg-score-m3',
    markFill: 'fill-score-m3',
    text: 'text-score-m3-ink',
    solidBg: 'bg-score-m3-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-m3-soft',
    border: 'border-score-m3-ink',
    ring: 'ring-score-m3-ink',
  },
  m2: {
    mark: 'bg-score-m2',
    markFill: 'fill-score-m2',
    text: 'text-score-m2-ink',
    solidBg: 'bg-score-m2-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-m2-soft',
    border: 'border-score-m2-ink',
    ring: 'ring-score-m2-ink',
  },
  m1: {
    mark: 'bg-score-m1',
    markFill: 'fill-score-m1',
    text: 'text-score-m1-ink',
    solidBg: 'bg-score-m1-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-m1-soft',
    border: 'border-score-m1-ink',
    ring: 'ring-score-m1-ink',
  },
  z0: {
    mark: 'bg-score-z0',
    markFill: 'fill-score-z0',
    text: 'text-score-z0-ink',
    solidBg: 'bg-score-z0-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-z0-soft',
    border: 'border-score-z0-ink',
    ring: 'ring-score-z0-ink',
  },
  p1: {
    mark: 'bg-score-p1',
    markFill: 'fill-score-p1',
    text: 'text-score-p1-ink',
    solidBg: 'bg-score-p1-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-p1-soft',
    border: 'border-score-p1-ink',
    ring: 'ring-score-p1-ink',
  },
  p2: {
    mark: 'bg-score-p2',
    markFill: 'fill-score-p2',
    text: 'text-score-p2-ink',
    solidBg: 'bg-score-p2-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-p2-soft',
    border: 'border-score-p2-ink',
    ring: 'ring-score-p2-ink',
  },
  p3: {
    mark: 'bg-score-p3',
    markFill: 'fill-score-p3',
    text: 'text-score-p3-ink',
    solidBg: 'bg-score-p3-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-p3-soft',
    border: 'border-score-p3-ink',
    ring: 'ring-score-p3-ink',
  },
  p4: {
    mark: 'bg-score-p4',
    markFill: 'fill-score-p4',
    text: 'text-score-p4-ink',
    solidBg: 'bg-score-p4-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-p4-soft',
    border: 'border-score-p4-ink',
    ring: 'ring-score-p4-ink',
  },
  p5: {
    mark: 'bg-score-p5',
    markFill: 'fill-score-p5',
    text: 'text-score-p5-ink',
    solidBg: 'bg-score-p5-ink',
    onSolid: 'text-white',
    softBg: 'bg-score-p5-soft',
    border: 'border-score-p5-ink',
    ring: 'ring-score-p5-ink',
  },
}

/**
 * Must stay equal to the @theme block in index.css. Recharts props take colour
 * values rather than class names, so the ramp is duplicated here and
 * utils/scoreColor.test.ts fails the build on any drift.
 */
export const SCORE_HEX: Record<ScoreKey, { mark: string; ink: string; soft: string }> = {
  m5: { mark: '#7f1d1d', ink: '#7f1d1d', soft: '#fef2f2' },
  m4: { mark: '#a4161a', ink: '#991b1b', soft: '#fef2f2' },
  m3: { mark: '#cc2936', ink: '#b42318', soft: '#fef2f2' },
  m2: { mark: '#e8590c', ink: '#9a3412', soft: '#fff7ed' },
  m1: { mark: '#f59f00', ink: '#a16207', soft: '#fefce8' },
  z0: { mark: '#94a3b8', ink: '#475569', soft: '#f8fafc' },
  p1: { mark: '#85c227', ink: '#4d7c0f', soft: '#f7fee7' },
  p2: { mark: '#4caf50', ink: '#15803d', soft: '#f0fdf4' },
  p3: { mark: '#2e9e4f', ink: '#166534', soft: '#f0fdf4' },
  p4: { mark: '#1b7f42', ink: '#14532d', soft: '#ecfdf5' },
  p5: { mark: '#0f5132', ink: '#0b3d21', soft: '#ecfdf5' },
}

export const scoreColor = (score: number): ScoreClasses => SCORE_CLASSES[scoreKey(score)]

export const scoreHex = (score: number): { mark: string; ink: string; soft: string } =>
  SCORE_HEX[scoreKey(score)]

/** Functional spec §4.1: a score is always shown with its signed number. */
export const formatScore = (score: number): string => (score > 0 ? `+${score}` : `${score}`)

/**
 * Averages: one decimal, signed, and an em dash for "not logged".
 * A day with no entries is never rendered as 0 (business rule 8).
 */
export const formatAverage = (average: number | null): string => {
  if (average === null) return '—'
  const sign = average > 0 ? '+' : average < 0 ? '−' : ''
  return `${sign}${Math.abs(average).toFixed(1)}`
}
