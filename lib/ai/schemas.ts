import { z } from 'zod'

/**
 * The AI analysis contract (functional spec §6.3).
 *
 * Two artifacts, deliberately:
 *
 *   - `zAnalysis` validates what the model returned. Never trust a provider's
 *     "strict" mode alone; a schema violation must be a caught error, not a
 *     malformed row.
 *   - `ANALYSIS_JSON_SCHEMA` is handed to the provider as its output schema.
 *
 * It is hand-written rather than generated from Zod because both providers'
 * structured-output modes accept only a narrow JSON Schema subset -- every
 * property required, `additionalProperties: false`, and NO numeric range
 * keywords. A generator emits `minimum`/`maximum` for `z.number().min()`, which
 * is rejected. `score` is therefore an enum of the eleven integers rather than a
 * range, which is valid on both.
 *
 * A test asserts the two stay in sync, so the duplication cannot rot.
 */

export const zFactor = z
  .object({
    label: z.string().min(1).max(60),
    reason: z.string().min(1).max(80),
  })
  .strict()

export const SCORE_VALUES = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5] as const

export const zAnalysis = z
  .object({
    /** With an image, the model's reading. With typed text, the user's text verbatim. */
    description: z.string().max(200),

    /**
     * The model's own final integer. ADVISORY ONLY -- domain/scoring.ts recomputes
     * the stored score from `modifier_sum` and the booleans. Kept because a large
     * disagreement between the two is the clearest signal that the prompt is
     * drifting.
     */
    score: z.number().int(),

    /**
     * The running total from the rubric, with BOTH proxy penalties at full value
     * and NONE of the four post-rules applied. Deliberately unclamped: clamping
     * before the proxy cap is applied would be off by one, and this is the number
     * our own code does arithmetic on.
     */
    modifier_sum: z.number().int(),

    rationale: z.string().min(1).max(600),
    positive_factors: z.array(zFactor).max(4),
    negative_factors: z.array(zFactor).max(4),

    /** Functional spec §4.2 N1. Drives the -2 cap. */
    has_trans_fat: z.boolean(),
    /** Drives the +1 floor. */
    whole_plant_only: z.boolean(),
    /** N9. Needed so our code can cap the two proxies at -1 combined. */
    proxy_ultra_processed: z.boolean(),
    /** N10. Same. */
    proxy_unidentified_fat: z.boolean(),

    /** False when an image contains no identifiable food; drives the §6.1 fallback. */
    food_detected: z.boolean(),
  })
  .strict()

export type Analysis = z.infer<typeof zAnalysis>
export type Factor = z.infer<typeof zFactor>

const factorSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'The ingredient or preparation, 2 to 4 words.' },
    reason: { type: 'string', description: 'A short lower-case phrase naming the mechanism.' },
  },
  required: ['label', 'reason'],
  additionalProperties: false,
} as const

/** Handed to the provider as its output schema. See the note above on why it is hand-written. */
export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description:
        'The dish. If the user typed a description, this is that text character for character.',
    },
    score: {
      type: 'integer',
      // An enum rather than minimum/maximum: neither provider's strict mode
      // supports numeric range keywords.
      enum: [...SCORE_VALUES],
      description: 'Your own final integer for the dish, -5 to +5. Advisory cross-check.',
    },
    modifier_sum: {
      type: 'integer',
      description:
        'The running total from the rubric with both proxy penalties at full value and none of the four post-rules applied. May fall outside -5..+5.',
    },
    rationale: {
      type: 'string',
      description: 'One to three sentences naming the specific ingredients that drove the number.',
    },
    positive_factors: { type: 'array', items: factorSchema },
    negative_factors: { type: 'array', items: factorSchema },
    has_trans_fat: { type: 'boolean' },
    whole_plant_only: { type: 'boolean' },
    proxy_ultra_processed: { type: 'boolean' },
    proxy_unidentified_fat: { type: 'boolean' },
    food_detected: { type: 'boolean' },
  },
  required: [
    'description',
    'score',
    'modifier_sum',
    'rationale',
    'positive_factors',
    'negative_factors',
    'has_trans_fat',
    'whole_plant_only',
    'proxy_ultra_processed',
    'proxy_unidentified_fat',
    'food_detected',
  ],
  additionalProperties: false,
} as const
