#!/usr/bin/env node
/**
 * The data-isolation audit (tech spec §4 and §11).
 *
 * Tech spec §4 makes the audit "a single command": `grep -rn "food_entries" api/`
 * must return nothing. This script is that grep, plus the four adjacent
 * invariants that are just as easy to break and just as quiet when broken. It is
 * wired into `npm run verify` so it is a build failure, not a habit.
 *
 * Run: node scripts/audit-isolation.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/** Vercel's own rules: a file under api/ starting with _ or . is not a function. */
function isHandlerFile(name) {
  return name.endsWith('.ts') && !name.endsWith('.d.ts') && !/^[_.]/.test(name)
}

function walk(dir, filter = () => true) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, filter))
    else if (filter(entry)) out.push(full)
  }
  return out
}

const failures = []
const notes = []

function fail(message) {
  failures.push(message)
}

const apiFiles = walk(join(ROOT, 'api'), isHandlerFile)
const serverFiles = [
  ...walk(join(ROOT, 'api'), (n) => n.endsWith('.ts')),
  ...walk(join(ROOT, 'lib'), (n) => n.endsWith('.ts')),
  ...walk(join(ROOT, 'domain'), (n) => n.endsWith('.ts')),
]

// ---------------------------------------------------------------------------
// 1. No handler may name food_entries. All of that SQL lives in one accessor
//    file, so a query missing its user_id cannot be written in a handler by
//    accident -- which is the entire bug class that file exists to prevent.
// ---------------------------------------------------------------------------
for (const file of apiFiles) {
  const text = readFileSync(file, 'utf8')
  text.split('\n').forEach((line, i) => {
    if (line.includes('food_entries')) {
      fail(`${relative(ROOT, file)}:${i + 1} names food_entries. All of it belongs in lib/server/entries.ts.`)
    }
  })
}

// ---------------------------------------------------------------------------
// 2. No handler may reach the database directly or carry raw SQL.
// ---------------------------------------------------------------------------
for (const file of apiFiles) {
  const text = readFileSync(file, 'utf8')
  if (/from '.*lib\/server\/db\.js'/.test(text)) {
    fail(`${relative(ROOT, file)} imports db.js. Handlers delegate; they hold no SQL.`)
  }
  if (/\bdb\(\)\s*`/.test(text)) {
    fail(`${relative(ROOT, file)} contains a SQL template literal. Move it behind a lib/server module.`)
  }
}

// ---------------------------------------------------------------------------
// 3. Server code may not use the @/ alias. Vercel does not support path
//    mappings when it bundles api/*.ts, so such an import would typecheck
//    locally and fail only once deployed.
// ---------------------------------------------------------------------------
for (const file of serverFiles) {
  const text = readFileSync(file, 'utf8')
  if (/from ['"]@\//.test(text)) {
    fail(`${relative(ROOT, file)} imports via the @/ alias, which Vercel cannot resolve in a function.`)
  }
}

// ---------------------------------------------------------------------------
// 4. Relative imports in the server half need explicit .js specifiers. The
//    server tsconfig already enforces this; this is the second net, and it also
//    covers domain/, which both halves import.
// ---------------------------------------------------------------------------
const RELATIVE_IMPORT = /from\s+['"](\.[^'"]*)['"]/g
for (const file of serverFiles) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(RELATIVE_IMPORT)) {
    const specifier = match[1]
    if (!specifier.endsWith('.js') && !specifier.endsWith('.json')) {
      // Test files run under Vite, which resolves either form.
      if (file.endsWith('.test.ts')) continue
      fail(`${relative(ROOT, file)} imports "${specifier}" without a .js extension.`)
    }
  }
}

// ---------------------------------------------------------------------------
// 5. The endpoint manifest must match the files on disk, and stay inside
//    Vercel Hobby's 12-function ceiling. Drift here is a 404 locally that works
//    in production, or vice versa.
// ---------------------------------------------------------------------------
const pluginSource = readFileSync(join(ROOT, 'tools', 'devApiPlugin.ts'), 'utf8')
const listMatch = pluginSource.match(/API_ENDPOINTS = \[([\s\S]*?)\] as const/)
if (!listMatch) {
  fail('could not read API_ENDPOINTS from tools/devApiPlugin.ts')
} else {
  const declared = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  const onDisk = apiFiles
    .map((file) => relative(join(ROOT, 'api'), file).replace(/\\/g, '/').replace(/\.ts$/, ''))
    .sort()

  for (const name of declared) {
    if (!onDisk.includes(name)) {
      notes.push(`declared but not implemented yet: api/${name}.ts`)
    }
  }
  for (const name of onDisk) {
    if (!declared.includes(name)) {
      fail(`api/${name}.ts exists but is not in API_ENDPOINTS. It will 404 locally.`)
    }
  }

  const HOBBY_FUNCTION_LIMIT = 12
  if (declared.length > HOBBY_FUNCTION_LIMIT) {
    fail(
      `${declared.length} endpoints declared, over Vercel Hobby's ${HOBBY_FUNCTION_LIMIT}-function ceiling. ` +
        `Multiplex methods inside an existing handler instead of adding a file.`,
    )
  }
}

// ---------------------------------------------------------------------------
for (const note of notes) console.log(`note: ${note}`)

if (failures.length > 0) {
  console.error(`\nisolation audit FAILED (${failures.length}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(
  `isolation audit passed: ${apiFiles.length} handler(s), ${serverFiles.length} server file(s) checked.`,
)
