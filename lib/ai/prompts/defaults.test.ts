import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROMPTS, PROMPT_KEYS, SCORING_PROMPT } from './defaults'
import { ANALYSIS_JSON_SCHEMA, zAnalysis } from '../schemas'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SEED_PATH = `${ROOT}db/migrations/002_seed_prompts.sql`

describe('the seed migration is generated, never hand-edited', () => {
  it('matches what scripts/generate-seed.mjs produces', () => {
    // The migration must be a committed file because deployed databases are
    // migrated by hand, but the same text also lives in TS. Regenerating and
    // comparing is the only thing that stops the two drifting.
    const before = readFileSync(SEED_PATH, 'utf8')
    execFileSync(process.execPath, [`${ROOT}scripts/generate-seed.mjs`], { stdio: 'pipe' })
    const after = readFileSync(SEED_PATH, 'utf8')
    expect(after).toBe(before)
  })

  it('dollar-quotes the bodies, because the rubric is full of apostrophes', () => {
    const sql = readFileSync(SEED_PATH, 'utf8')
    expect(sql).toContain('$prompt$')
    for (const key of PROMPT_KEYS) {
      expect(sql).toContain(`('${key}', $prompt$`)
    }
  })

  it('is idempotent, so re-running cannot clobber an administrator edit', () => {
    const sql = readFileSync(SEED_PATH, 'utf8')
    const inserts = sql.match(/insert into prompts/g) ?? []
    expect(inserts).toHaveLength(PROMPT_KEYS.length)
    expect(sql.match(/on conflict \(key\) do nothing/g)).toHaveLength(PROMPT_KEYS.length)
  })

  it('does not seed anyone’s email address', () => {
    // ALLOWED_EMAILS is the bootstrap; a personal address must not be committed.
    const sql = readFileSync(SEED_PATH, 'utf8')
    expect(sql).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
  })
})

describe('the scoring prompt encodes the whole rubric', () => {
  it('asks for the unclamped modifier sum and says our code owns the post-rules', () => {
    // This is the contract that lets domain/scoring.ts decide the final integer.
    expect(SCORING_PROMPT).toContain('modifier_sum')
    expect(SCORING_PROMPT).toContain('NONE of rules 1 to 4 applied')
    expect(SCORING_PROMPT).toContain('It MAY fall outside')
  })

  it('names every negative and positive modifier line', () => {
    // Nine negatives, ten positives -- the rubric in functional spec §4.2.
    for (let i = 1; i <= 9; i += 1) {
      expect(SCORING_PROMPT).toMatch(new RegExp(`\\bN${i}\\b`))
    }
    expect(SCORING_PROMPT).not.toContain('N10')
    for (let i = 1; i <= 10; i += 1) {
      expect(SCORING_PROMPT).toMatch(new RegExp(`\\bP${i}\\b`))
    }
  })

  it('requires both proxy booleans at full value so our code can cap them', () => {
    expect(SCORING_PROMPT).toContain('proxy_ultra_processed')
    expect(SCORING_PROMPT).toContain('proxy_unidentified_fat')
    expect(SCORING_PROMPT).toContain('Report BOTH at full value')
  })

  it('forbids the trans-fat / whole-plant contradiction', () => {
    expect(SCORING_PROMPT).toContain('MUST be false whenever `has_trans_fat` is true')
  })

  it('carries the homemade-flag rule', () => {
    expect(SCORING_PROMPT).toContain('is_homemade = false')
    expect(SCORING_PROMPT).toContain('less favourable')
  })

  it('carries the deliberately-not-penalized note', () => {
    // Functional spec §4.2: dietary cholesterol as a category, and shellfish.
    expect(SCORING_PROMPT).toContain('dietary cholesterol as a general category')
    expect(SCORING_PROMPT).toContain('shellfish')
    expect(SCORING_PROMPT).toContain('LEAN PROTEIN')
  })

  it('forbids rewriting a description the user typed', () => {
    // The cache key depends on this: a rewritten description would miss its own
    // cache entry on the very next request.
    expect(SCORING_PROMPT).toContain('character for\n    character')
    expect(SCORING_PROMPT).toContain('Do not translate it')
  })

  it('covers Latin American dishes explicitly, and says the list is not the limit', () => {
    for (const dish of ['Milanesa napolitana', 'Chivito', 'Feijoada', 'Bandeja paisa']) {
      expect(SCORING_PROMPT).toContain(dish)
    }
    expect(SCORING_PROMPT).toContain('it is not the limit of it')
  })

  it('accumulates step by step, which is what makes repeats agree', () => {
    expect(SCORING_PROMPT).toContain('one at a time')
    expect(SCORING_PROMPT).toContain('same description score the same way twice')
  })

  it('defines the no-food and the nonsense-text cases separately', () => {
    // Functional spec §6.1 only defines the image case; typed nonsense needs its
    // own answer or the model has to invent one.
    expect(SCORING_PROMPT).toContain('food_detected')
    // Assert across the line wrap rather than on an exact substring.
    expect(SCORING_PROMPT).toMatch(/not describe a dish at all/)
    expect(SCORING_PROMPT).toMatch(/recognisable dish/)
  })
})

describe('the provider JSON schema matches the Zod schema', () => {
  it('declares exactly the fields Zod validates', () => {
    const zodKeys = Object.keys(zAnalysis.shape).sort()
    const schemaKeys = Object.keys(ANALYSIS_JSON_SCHEMA.properties).sort()
    expect(schemaKeys).toEqual(zodKeys)
  })

  it('requires every property, as both providers demand', () => {
    expect([...ANALYSIS_JSON_SCHEMA.required].sort()).toEqual(
      Object.keys(ANALYSIS_JSON_SCHEMA.properties).sort(),
    )
  })

  it('forbids extra properties', () => {
    expect(ANALYSIS_JSON_SCHEMA.additionalProperties).toBe(false)
  })

  it('uses an enum for score rather than a numeric range', () => {
    // Neither provider's strict mode accepts minimum/maximum.
    const serialized = JSON.stringify(ANALYSIS_JSON_SCHEMA)
    expect(serialized).not.toContain('minimum')
    expect(serialized).not.toContain('maximum')
    expect(ANALYSIS_JSON_SCHEMA.properties.score.enum).toHaveLength(11)
  })

  it('leaves modifier_sum unbounded, since it is deliberately unclamped', () => {
    expect(ANALYSIS_JSON_SCHEMA.properties.modifier_sum).not.toHaveProperty('enum')
  })
})

describe('both prompts are present and substantial', () => {
  it.each(PROMPT_KEYS)('%s is seeded', (key) => {
    expect(DEFAULT_PROMPTS[key].length).toBeGreaterThan(1000)
  })
})
