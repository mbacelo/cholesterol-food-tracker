#!/usr/bin/env node
/**
 * Generates db/migrations/002_seed_prompts.sql from lib/ai/prompts/defaults.ts.
 *
 * The migration has to be a committed file, because deployed databases are
 * migrated by hand in the Neon SQL editor. But the same text also lives in TS,
 * where the fixture suite and the prompt-editor tests read it. Generating one
 * from the other is the only way those two cannot drift; a test asserts the file
 * on disk matches what this script would produce.
 *
 * Run: node scripts/generate-seed.mjs
 */

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_PROMPTS, PROMPT_KEYS } from '../lib/ai/prompts/defaults.ts'

const ROOT = resolve(import.meta.dirname, '..')
const TARGET = join(ROOT, 'db', 'migrations', '002_seed_prompts.sql')

/**
 * Dollar quoting is mandatory here, not stylistic: the rubric text is full of
 * apostrophes, and single-quote escaping would corrupt it.
 */
const TAG = '$prompt$'

for (const key of PROMPT_KEYS) {
  if (DEFAULT_PROMPTS[key].includes(TAG)) {
    console.error(`prompt ${key} contains the dollar-quote tag ${TAG}; choose another tag`)
    process.exit(1)
  }
}

const statements = PROMPT_KEYS.map(
  (key) => `insert into prompts (key, body, version) values
  ('${key}', ${TAG}${DEFAULT_PROMPTS[key]}${TAG}, 1)
on conflict (key) do nothing;`,
).join('\n\n')

const sql = `-- 002_seed_prompts.sql
--
-- GENERATED FILE. Do not edit by hand.
--   source:    lib/ai/prompts/defaults.ts
--   regenerate: node scripts/generate-seed.mjs
--
-- Seeds live separately from 001_init.sql on purpose: 001 should be
-- environment-neutral and re-runnable against any fresh database, whereas these
-- multi-kilobyte bodies are CONTENT that an administrator is expected to edit in
-- production. So this is a one-time bootstrap, not schema.
--
-- \`on conflict do nothing\` makes it idempotent and, more importantly, means
-- re-running it can never clobber an administrator's edit.
--
-- The bodies are dollar-quoted because the rubric is full of apostrophes and
-- single-quote escaping would corrupt it.
--
-- The owner's allowlist row is deliberately NOT seeded here: ALLOWED_EMAILS is
-- the bootstrap the spec designs for, and a personal email address does not
-- belong in a committed migration.

${statements}

insert into schema_migrations (version) values ('002_seed_prompts')
on conflict (version) do nothing;
`

writeFileSync(TARGET, sql, 'utf8')
console.log(`wrote ${TARGET} (${sql.length} bytes)`)
