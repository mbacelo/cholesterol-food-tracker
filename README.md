# Cholesterol Food Tracker

Log a dish, see its likely effect on LDL cholesterol, and track it against a
personal goal. Mobile-first PWA; React SPA plus Vercel serverless functions.

- `functional-spec.md` — what the app does
- `tech-spec.md` — how it is built

Both describe the app as it stands. For how it got here, read the git history.

## Run it locally, with no cloud accounts

```sh
npm install
cp .env.local.example .env.local
```

Then in `.env.local` set just these:

```
DEBUG_AUTH=true
DEBUG_ADMIN=true
SESSION_SECRET=<any 32+ characters>
AI_PROVIDER=mock          # or anthropic / openai with a real key
```

```sh
npm run dev
```

Everything else falls back:

| Service | Without credentials |
|---|---|
| Neon Postgres | PGlite in-process, persisted to `.dev-data/`, migrations applied automatically |
| Google sign-in | skipped; you are a seeded local debug user with a persistent banner |
| The model | `AI_PROVIDER=mock` is deterministic and free |

Every fallback is refused in a deployed environment, where a missing variable is
a configuration error rather than an invitation to run on a throwaway store.

To check real scoring quality, set `AI_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY`. That spends money on every uncached analysis; repeats are
free (see `score_cache`). `AI_EFFORT` trades latency for depth — default `low` is
~6s, `high` is ~17s.

For a cheaper run, `AI_PROVIDER=openai` with `OPENAI_API_KEY` defaults to
`gpt-5.6-luna` -- $0.20/$1.20 per MTok against Sonnet 5's
$3/$15, so ~15x cheaper on input and ~12x on output. `AI_EFFORT` applies there
too, and defaults to `low` on both providers.

## Commands

| | |
|---|---|
| `npm run dev` | UI and `/api` together, real handlers in-process |
| `npm run verify` | typecheck, tests, isolation audit — run before deploying |
| `npm test` | 208 tests; no credentials, no network, no spend |
| `npm run build` | typecheck then production build |
| `npm run audit` | the data-isolation audit on its own |
| `npm run generate:icons` | regenerate PWA PNGs from `public/icon.svg` |

`npm run preview` serves the UI only — **`/api/*` returns `index.html` there**,
because the dev plugin does not run in preview. That is expected, not an outage.

## Deploying

1. Neon project; run `db/migrations/001_init.sql` then `002_seed_prompts.sql` in
   the SQL editor.
2. Google OAuth client ID.
3. Set every variable from `.env.local.example` in Vercel, for Production **and**
   Preview, except `DEBUG_AUTH`/`DEBUG_ADMIN` — those are ignored when deployed
   regardless. There is no object storage to configure: photos are read by the
   model and never stored.
4. Put your address in `ALLOWED_EMAILS` and `ADMIN_EMAILS`, sign in, then manage
   the durable allowlist from the admin area.

Set the Vercel region to match the Neon region: the HTTP driver's latency
dominates most endpoints.

## Two invariants worth knowing before changing anything

- **All `food_entries` SQL lives in `lib/server/entries.ts`**, every function
  takes `userId` first, and every statement carries `user_id`. `npm run audit`
  fails the build if a handler touches that table.
- **Adding an endpoint means editing `API_ENDPOINTS` in `tools/devApiPlugin.ts`
  in the same commit.** Otherwise it 404s locally while working in production.
  The audit checks this too, and that Vercel Hobby's 12-function ceiling holds.
