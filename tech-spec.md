# Cholesterol Food Tracker, Technical Specification

Companion to `functional-spec.md`, which defines **what** the app does. This document defines **how** it is built.

Constraints that shaped every choice: one developer, a handful of users, mobile-first, minimal infrastructure, free hosting everywhere except the LLM.

---

## 1. Stack

| Concern | Choice |
|---|---|
| Frontend | React 19 + TypeScript 7 + Vite 8, single-page app, installable PWA |
| Styling / icons | Tailwind CSS v4 + `lucide-react` |
| Routing | `react-router` v7, declarative mode |
| Charts | Recharts |
| Backend | Vercel serverless functions under `api/` |
| Database | Neon Postgres via `@neondatabase/serverless`, raw SQL, no ORM. Locally, PGlite in-process when `DATABASE_URL` is absent |
| Auth | Google Identity Services, server-verified once, then an httpOnly session cookie |
| AI | Multimodal models behind a provider interface, strict JSON schema output. Two are implemented, Anthropic and OpenAI, plus a deterministic offline `mock` for tests |
| Validation | Zod, shared between request bodies and AI output parsing |
| Tests | Vitest on pure logic modules |
| Hosting | Vercel Hobby |

A Vite SPA plus serverless functions is chosen over a full-stack framework deliberately: every screen is authenticated, interactive and unindexable, so server rendering buys nothing and costs extra concepts. A managed Postgres and an object store, each behind one module, is less to learn and operate than an all-in-one backend platform.

### Cost

| Service | Tier | Notes |
|---|---|---|
| Vercel | Hobby | Free. Non-commercial use, which a personal app is. |
| Neon | Free | ~0.5 GB. The schema is text-only and photos are never stored, so effectively unlimited here. |
| Google OAuth | Free | — |
| LLM provider | **Paid** | The only bill. §7 covers the four mechanisms that keep it small. |

`@vercel/node` is deliberately **not** a dependency: the handler contract is ~20
lines in `lib/server/http.ts`, which avoids putting a dev dependency with
high-severity advisories into production code's type surface.

---

## 2. Architecture

```
Phone browser — React SPA, PWA, installed to home screen
  │  fetch, httpOnly session cookie
  ▼
Vercel serverless functions  /api/*   (10 files; Vercel Hobby allows 12,
  │                                     and the audit fails the build at 13)
  ├── session      GET rehydrate · POST sign in · DELETE sign out
  ├── analyze      POST  image and/or text → description + score  (stateless, stores nothing)
  ├── entries      GET list/day/one · POST create · PATCH · DELETE
  ├── settings     GET · PATCH
  ├── summary      GET   → dashboard aggregates, computed in SQL
  ├── export       GET   → CSV
  └── admin/       ping (the probe) · allowlist · prompts · users
        │                                          │
        ▼                                          ▼
   Neon Postgres                              LLM API
   rows and text -- every byte the app keeps   key stays server-side
```

### Security boundary

- **The browser never holds the AI key and never calls the model.** All analysis goes through `/api/analyze`.
- **The browser never sends a score.** Scores are computed server-side and are not accepted from any request body.

### Handler skeleton

Every endpoint under `api/` follows the same order and does nothing else:

```
method check → authenticate → allowlist check → rate limit → validate input → delegate
```

Handlers stay thin: no SQL, no prompts, no business rules. Every `catch` logs the real error server-side and returns a generic message, so provider errors, keys and SQL never reach the client.

### File layout

```
api/                    one file per endpoint, thin
lib/server/
  googleAuth.ts         Google ID token verification
  session.ts            sign/verify the session cookie; requireUser(); requireAdmin()
  allowlist.ts          env bootstrap OR database, see §5
  admins.ts             isAdminEmail() — ADMIN_EMAILS only, never a table
  users.ts              user provisioning and settings SQL
  entries.ts            all food_entries SQL — the isolation boundary, see §4
  prompts.ts            read/write/revert the prompts table
  scoreCache.ts         the only file with score_cache SQL; the cache key
  images.ts             image byte validation for /api/analyze; nothing is stored
  usage.ts              durable per-user AI budget + burst limiter + analysis log
  db.ts                 Neon client, or PGlite locally
  env.ts                isLocalEnvironment(), debugEnabled(), debugIsAdmin()
  errors.ts             ApiError / handleError — one exit path for every failure
  http.ts               the request/response contract every handler is written against
  debug.ts              seeds the local debug user as a real users row
lib/ai/
  index.ts              getProvider(), keyed off AI_PROVIDER
  types.ts              AIProvider interface, shared shapes
  providers/anthropic.ts
  providers/openai.ts
  providers/mock.ts     deterministic, offline; for tests and for building without a key
  prompts/defaults.ts   the seeded prompt bodies; 002_seed_prompts.sql is GENERATED from this
  analyze.ts            one call: image and/or description + homemade flag → full result
  schemas.ts            Zod schema AND a hand-written provider json_schema, kept in sync by a test
domain/
  scoring.ts            proxy cap, trans-fat cap, whole-plant floor, clamp — PURE, no I/O
  aggregation.ts        daily average, days on target, incomplete days — PURE, no I/O
routes/                 Today, Log, History, EntryDetail, Dashboard, Me, Admin
components/             ScoreBadge, FactorChip, EntryRow, charts, BottomNav
lib/requests.ts         Zod request schemas, all .strict()
lib/dates.ts            server-side local-date maths from tz_offset_minutes
lib/csv.ts              pure CSV serializer, with formula-injection defusing
utils/image.ts          client-side canvas downscale + JPEG re-encode
utils/localDate.ts      the user's local today and tz offset — the only source of "today"
utils/api.ts            apiFetch, ApiError, and the error-code → copy map
tools/devApiPlugin.ts   the dev API plugin, and the two drift-prone lists
scripts/audit-isolation.mjs   the §4 audit, plus four adjacent invariants
scripts/generate-seed.mjs     regenerates 002_seed_prompts.sql from the TS constants
db/migrations/          001_init.sql (schema), 002_seed_prompts.sql (generated)
```

`domain/` holds every rule that is arithmetic or a decision table, as pure functions with no network or database access. All derived figures — daily averages, period averages, days on target, incomplete-day flags — come from `aggregation.ts`. **Never recompute an average ad hoc.** This is what makes the business rules in functional spec §7 testable without a network call, and it is the highest-value test surface in the app.

Split screens by route, each owning its local state, with only the session and user settings in a shared context. No monolithic root component.

### Local development

`npm run dev` must serve the UI **and** `/api` together, so the real serverless handlers run in-process without a separate CLI. This is a small dev-only Vite plugin that reads `.env.local` for server env, exposes only `VITE_`-prefixed vars to the browser, and maps `/api/<name>` to the corresponding handler module. Two lists in `tools/devApiPlugin.ts` — the server env keys the handlers read, and the endpoint names — must be updated in the same commit that adds an endpoint, or the route 404s locally while working in production. They live in that module rather than in `vite.config.ts` so `scripts/audit-isolation.mjs` can read the same source of truth and fail the build on drift.

Files under `api/` and `lib/` import with explicit `.js` ESM specifiers (`./types.js`) even though sources are `.ts`, as Node ESM resolution on Vercel requires. Frontend files use extensionless imports.

**Typecheck is four projects, and the split is load-bearing.** TypeScript 7 makes `baseUrl` a hard error, and Vercel supports neither `paths` nor project references — it reads the **root** tsconfig when compiling `api/`. The root tsconfig is therefore the browser project, where `@/*` maps to the repo root; the server project omits `paths` entirely, which turns an `@/` import in server code into a compile error rather than a deployment that fails to resolve.

Scripts: `dev`, `build`, `preview`, `typecheck` (four strict projects), `test` (`vitest run`), `audit`, `verify`.

---

## 3. Database

Neon Postgres over the HTTP serverless driver, so no connection pooler is needed. Raw tagged-template SQL, no ORM: the schema is small enough that an ORM adds indirection without removing work.

Schema changes go in numbered files under `db/migrations/`, applied by hand in the Neon SQL editor. No runtime auto-creation of tables — with an evolving schema, silently creating a stale table is worse than failing loudly. Because they are applied by hand, `schema_migrations` is the only record of what a given database has actually seen.

`pgcrypto` is loaded as a PGlite contrib extension locally — it is not in PGlite's base bundle — so the migrations run against the dev store byte-for-byte as they do on Neon.

`002_seed_prompts.sql` seeds both prompt bodies and is **generated** from `lib/ai/prompts/defaults.ts` by `scripts/generate-seed.mjs`, dollar-quoted because the rubric is full of apostrophes. The owner's allowlist row is not seeded: `ALLOWED_EMAILS` is the bootstrap, and a personal address does not belong in a committed migration.

```sql
-- 001_init.sql
create extension if not exists pgcrypto;

create table users (
  id            uuid primary key default gen_random_uuid(),
  google_sub    text unique not null,           -- stable identity; email can change
  email         text unique not null,
  is_admin      boolean not null default false, -- display convenience only, see §5
  daily_average_target numeric(3,1) not null default 1.0
    check (daily_average_target between -2.0 and 5.0),
  min_entries_for_valid_day int not null default 2
    check (min_entries_for_valid_day between 1 and 5),
  created_at    timestamptz not null default now()
);

create table allowlist (
  email      text primary key,
  blocked    boolean not null default false,
  added_at   timestamptz not null default now()
);
-- "invited vs active" is derived: a matching users row means they have signed in.

create table food_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  entry_date  date not null check (entry_date <= current_date + 1),
  description text not null check (char_length(description) between 1 and 200),
  is_homemade boolean not null default true,
  score       int  not null check (score between -5 and 5),
  rationale   text not null,
  positive_factors jsonb not null default '[]',  -- [{label, reason}]
  negative_factors jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index food_entries_user_date_idx
  on food_entries (user_id, entry_date desc, created_at desc);

create table prompts (
  key           text primary key,   -- 'image_analysis_prompt' | 'scoring_prompt'
  body          text not null,
  previous_body text,               -- one-step revert, see §7
  version       int  not null default 1,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

-- Per-user daily AI budget. Durable, so it survives cold starts.
create table ai_usage (
  email text not null,
  day   date not null,
  calls int  not null default 0 check (calls >= 0),
  primary key (email, day)
);
create index ai_usage_day_idx on ai_usage (day);

-- Scoring cache. Also the determinism guarantee — see §7.
create table score_cache (
  hash       text primary key,  -- sha256(key schema | provider | model | prompt versions | homemade | normalized description)
  result     jsonb not null,
  created_at timestamptz not null default now()
);
create index score_cache_created_at_idx on score_cache (created_at);

-- Which migrations have been applied.
create table schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);
```

Notes:

- Factor lists are `jsonb` rather than a child table: they are display-only, always read with their entry, never queried independently.
- **`score_cache.result` stores the validated model output, not the final score**, so a fix in `domain/scoring.ts` reaches cached rows without a purge. It deliberately holds nothing that identifies a person: the table is keyed by hash and is **not user-scoped**, which would otherwise be the one privacy seam in a strictly isolated schema.
- **There is no image column.** A photo is input to `/api/analyze` and nothing else, so there is no object store to provision and no keys to keep in sync with these rows. See §6.
- **Dates are the user's local dates.** `entry_date` is a plain date supplied by the client, so every aggregation is timezone-free. Requests carry `tz_offset_minutes`; the server computes the caller's local date and rejects anything later. The `current_date + 1` constraint is a backstop with one day of slack, so a client an hour ahead of UTC is never rejected by the constraint instead of by validation.
- Every column the functional spec calls read-only is written only by server code. No code path accepts a score, rationale or factor list from a client.

---

## 4. Data isolation

Enforced in application code, structured so the failure mode cannot be reached by accident:

1. **All `food_entries` SQL lives in `lib/server/entries.ts`.** No endpoint handler writes SQL against that table.
2. **Every exported function takes `userId` first**, and every statement carries `where user_id = ${userId}`, including updates and deletes:
   ```ts
   export async function updateEntry(userId: string, entryId: string, patch: EntryPatch)
   // update food_entries set ... where id = ${entryId} and user_id = ${userId} returning *
   ```
   A `where id = ...` without `user_id` is the entire bug class this file exists to prevent. Zero rows returned is a 404, never a silent success.
3. **`userId` comes only from the verified session** — never from a body, query parameter or header. Handlers get it from `requireUser(req)` and pass it down. A `user_id` in a request body is ignored, and a test asserts that.
4. **Administrators cannot reach food data.** Admin endpoints touch `food_entries` only via `count(*)` and `delete`. No admin response can carry a description, score or rationale. User deletion is `delete from users where id = ...` and the cascade — one statement, with nothing outside Postgres to clean up.
5. Because there is exactly one accessor file, the audit is a single command: `grep -rn "food_entries" api/` must return nothing.

---

## 5. Authentication and access

Two steps:

1. **Google Identity Services** in `index.html` produces an ID token in the browser. That is the client's only Google interaction; any client-side JWT decode is for display only.
2. **`POST /api/session`** verifies the token server-side with `google-auth-library`, checks the allowlist, provisions the `users` row on first login, then signs a small JWT with `jose` and returns it as `httpOnly; Secure; SameSite=Lax; Max-Age=7d`. Every later request authenticates from that cookie: no Google round-trip, no token in JavaScript, and the session survives the app being backgrounded on a phone.

Token verification must **fail closed on a missing `GOOGLE_CLIENT_ID`**: the Google library skips audience checking entirely when no audience is supplied, which would accept tokens minted for any Google OAuth client. A configuration gap must never widen who can sign in.

**Allowlist.** Two server-side sources: `ALLOWED_EMAILS` as the owner bootstrap and the fallback when the database is unreachable, or an unblocked `allowlist` row in Postgres, which is the live source of truth so approvals take effect without a redeploy. A refused login returns a distinct error code so the UI can say "not authorized" rather than showing a generic failure.

**Revocation.** A 7-day cookie would otherwise outlive a block, so `requireUser()` re-checks the allowlist on every request — one indexed query, cached in-process for 60 seconds. A blocked or missing row returns 401 and clears the cookie. This satisfies "blocking takes effect immediately" more strongly than a login-time-only check.

**Administrators are defined by `ADMIN_EMAILS` and never authoritatively in the database.** The admin UI writes to `allowlist`; keeping the role out of every table that UI can write means the admin screen cannot grant admin to anyone, including itself. `users.is_admin` exists only as a denormalized rendering hint — `requireAdmin()` reads the env var, always. Do not add an authoritative role column for a future feature without revisiting this.

The client cannot read `ADMIN_EMAILS`, so it probes an admin endpoint once per sign-in: 200 means administrator, anything else means not. **A failed probe must never surface as an error** — 403 is the normal path for every ordinary user. Hiding the menu item is a convenience; the server-side re-check on every admin action is the boundary.

**Debug mode** (functional spec §2.1) is one server-only module requiring all three conditions:

```ts
export const debugEnabled = () =>
  process.env.DEBUG_AUTH === "true" &&
  process.env.NODE_ENV !== "production" &&
  !process.env.VERCEL;              // set on every Vercel deployment
```

A deployed build cannot satisfy this regardless of which env vars are set. When enabled, `requireUser()` returns a seeded local debug user — a real `users` row, so every rule still applies to it — `DEBUG_ADMIN=true` grants admin, and the client renders a persistent banner keyed off `import.meta.env.DEV`.

---

## 6. Images

**Photos are transient. Nothing is stored.** A photo is a way to *describe* a
dish: it is compressed on the device, posted to `/api/analyze`, shown on screen
while the Log flow is open, and discarded on save or discard. The description the
model returns is the record.

Keeping an archive would buy a thumbnail on the entry row and a picture on the
detail screen, and cost an object-store integration, four secrets, a
presigned-URL endpoint, two blob-deletion paths, a local-fallback store for
development, a Vercel function slot against a ceiling of twelve, and a growing
record of photographs of what someone eats. The description already carries
everything the score is computed from, so that archive would add risk without
adding an answer.

- **Compression is client-side**, and exists purely to cut image tokens and
  upload time. A canvas downscale to max 1280 px at JPEG quality ~0.7 yields
  roughly 200–400 KB while preserving enough detail to identify a dish. EXIF is
  dropped by the re-encode, so orientation is baked in and location is not sent.
- **One endpoint accepts an image:** `/api/analyze`. `POST /api/entries` has no
  image field and is `.strict()`, so a photo cannot be smuggled into the database
  by a client that tries. The bytes cross the wire exactly once.
- **Bytes are validated** in `lib/server/images.ts`: a MIME allowlist, a 3.5 MB
  decoded cap, and a **magic-byte** check against the declared type, because a
  content type is only a claim. The body-parser limit is 4 MB in dev and in
  production alike — Vercel hard-caps a request payload at 4.5 MB
  (`413 FUNCTION_PAYLOAD_TOO_LARGE`) before a handler runs, so a larger local
  limit would accept requests production rejects.
- **Transport is base64 in JSON**, to `/api/analyze` only. The runtime parses
  JSON for free, one Zod schema validates the whole body, and ~400 KB becomes
  ~547 KB — well inside the 4 MB limit.
- **Deletion is not a concern.** Deleting an entry is one `delete`; deleting a
  user is the `on delete cascade`. There is no orphan sweeper, no temporary-key
  lifecycle, and no bucket to keep in sync with the rows.

---

## 7. AI scoring

Providers sit behind an `AIProvider` interface with one switch point, `getProvider()`, keyed off `AI_PROVIDER`; the model id is `AI_MODEL`, and reasoning depth is `AI_EFFORT` (default `low`, see functional spec §9). Anthropic, OpenAI and an offline `mock` are implemented; adding another means one file plus one `case`. `AI_PROVIDER` has no default — a silent one would make the difference between a real, billable model and a stub invisible. Prompts and output shape are shared, so all providers extract identically.

Both prompts are loaded from the `prompts` table at request time, never from code, so administrator edits take effect immediately and apply to future analyses only. Saving a prompt copies the old body into `previous_body` and bumps `version`; **Revert** swaps them back. That one column is the whole safety net for a bad prompt edit.

**One call per analysis.** `analyze({ image?, description?, isHomemade })` makes a single model request and returns `{ description, score, modifier_sum, rationale, positive_factors, negative_factors, has_trans_fat, whole_plant_only, proxy_ultra_processed, proxy_unidentified_fat, food_detected }` using the provider's strict JSON-schema mode, re-validated with Zod. A provider's own "strict" mode is never trusted alone: a schema violation must be a caught error, not a malformed row. The provider JSON schema in `lib/ai/schemas.ts` is hand-written beside the Zod one — both structured-output modes accept only a narrow subset, with no numeric range keywords, so `score` is an enum of the eleven integers — and a test asserts the two stay in sync.

- The system prompt is `scoring_prompt`, with `image_analysis_prompt` prepended only when an image is attached.
- With an image, the model produces the description. With typed text, the user's text **is** the description and the model must not rewrite it, which keeps the cache key stable.
- The result then passes through `domain/scoring.ts`, which applies the proxy cap, the trans-fat cap, the whole-plant floor and the clamp **in our own code**, using `modifier_sum` and the four booleans. The model proposes; our code decides the final integer. The model's own `score` is advisory, and a large divergence from the computed one is logged as a prompt-drift signal.
- `food_detected: false` drives the specified fallback: keep the photo, ask the user to type a description.
- Invalid output is retried once, then surfaces a clear error. Nothing is saved without a valid score.

**The score is never accepted from the client.** `POST /api/entries` takes only `{ description, is_homemade, entry_date, tz_offset_minutes }`. This closes "no interface anywhere lets a user alter a score" at the protocol level rather than by hiding an input.

**Re-scoring** is decided in one function in `lib/server/entries.ts`: a PATCH whose `description` or `is_homemade` differs from the stored row re-scores before committing; a date-only change does not.

**Quick check** is not a code path. `/api/analyze` writes nothing, so an analysis the user discards leaves no trace, and "save as entry" is an ordinary create.

### Determinism

The functional spec requires that the same description scored twice differ by no more than one point. Three mechanisms, strongest first:

1. **`score_cache`, keyed on `sha256(key schema | provider | model | prompt versions | is_homemade | normalized description)`.** A repeat returns a byte-identical result — a zero-point difference, better than the one point the functional spec allows — and costs nothing. This covers review-screen editing and everyday repeated dishes. A photo analysis writes its result into the cache under the description it produced, so a later identical description hits it. Including the prompt versions means an administrator's edit invalidates the cache naturally, while existing entries keep their stored scores, exactly as the non-retroactivity rule requires.
2. **A rubric prompt that accumulates modifiers step by step**, for inputs never seen before.

   **No temperature is sent, on either provider, and the `AIProvider` interface does not expose one.** Current Anthropic models have removed `temperature`/`top_p`/`top_k` and reject them with a 400. On OpenAI a fixed temperature is legal only at reasoning effort `none`, and reasoning is worth more to scoring quality than a fixed temperature is to stability, so that path reasons at `AI_EFFORT` instead. Each provider decides internally; determinism rests on mechanisms 1 and 3.
3. **A Vitest suite of ~30 fixed descriptions** asserting each lands in an expected band, plus unit tests for the post-rules in `domain/scoring.ts`. The fixture half calls the real model, so it is opt-in behind `RUN_AI_FIXTURES`. Run it after every prompt edit; it is the regression net for the riskiest acceptance criterion in the spec.

### Cost control

Four layers: one call per analysis rather than a description pass and a scoring pass; client-side compression to cut image tokens; `score_cache` to make repeat scoring free; and `ai_usage` for a durable per-user daily cap in Postgres. A small in-memory per-email limiter additionally absorbs bursts, but it is not the budget — it resets on every cold start, and this app calls the model on every new entry *and* every description edit.

The budget is checked read-only in the handler and **consumed inside `analyze()`, after a cache miss and immediately before the billable call**, so a cache hit never costs quota.

---

## 8. Frontend

- **Navigation:** five destinations in a persistent bottom bar (Today, History, Log, Dashboard, Me), plus an entry detail route and an `/admin` area gated by the admin probe.
- **Data fetching:** plain `fetch` inside small hooks. Invalidation here is "refetch the current day or page after a mutation", which does not justify a caching library.
- **Score colors:** one `scoreColor(score)` helper used everywhere a score appears, mapping -5 deep red through 0 grey to +5 deep green, always rendered with the signed number. Tailwind purges interpolated class names, so write the full class strings out in that one module and add them to the `@source inline(...)` safelist in `index.css`.
- **Charts:** Recharts. A line chart of daily averages with a `ReferenceLine` at the target, and a bar chart of the -5..+5 distribution with per-bar `Cell` colors. Below a minimum data threshold both render a "keep logging to see trends" state rather than an empty axis.
- **Camera:** `<input type="file" accept="image/*" capture="environment">` opens the camera directly. No native shell needed.
- **Dates:** every date the client sends comes from `utils/localDate.ts`, along with `tz_offset_minutes`. Nothing formats or compares dates ad hoc.
- **History:** keyset pagination on `(entry_date, created_at)` with infinite scroll. Search is `description ilike '%q%'`; at this data volume a full-text index is unnecessary.
- **Dashboard:** aggregate in SQL (`avg(score) group by entry_date` over the period), not in the client.
- **Edit affordances:** edits apply live to local state, with Apply/Cancel implemented by snapshotting state into a ref when an edit mode opens and restoring it on cancel.
- **Paid calls are tap-only:** `/api/analyze` is called from an event handler and nothing else -- the photo pick, "Score this dish", "Re-score". `routes/Log` holds no debounce timer and no `onBlur` trigger; a `scoredHash` of `(description, is_homemade)` marks the visible score stale and disables Save until the user asks for the re-score. Typing is free by construction, and no effect can double-charge under StrictMode.
- **In-progress capture is persisted** to localStorage: the compressed image on its own key, since it is large and changes once per photo, and the description plus analysis result on another. Both stamped with a `SESSION_VERSION` bumped whenever the persisted shape changes, so stale data is discarded rather than rehydrated. A mobile refresh mid-review must not force a second paid call. Restored only into the review step, never the analyzing step.
- **PWA:** manifest plus icons so it installs to the home screen, with `name: "Cholesterol Food Tracker"` and `short_name: "Cholesterol"` so the icon label is not truncated. No offline write queue, since logging needs the model, so show a clear offline state instead.
- **Export:** a serverless endpoint streams CSV with `Content-Disposition: attachment`.

---

## 9. Operations

- **Secrets** (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, `AI_PROVIDER`, `AI_MODEL`, `AI_EFFORT`, `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `DATABASE_URL`, `ALLOWED_EMAILS`, `ADMIN_EMAILS`, `AI_DAILY_CALL_LIMIT`, `DEBUG_AUTH`, `DEBUG_ADMIN`) are server-only env vars. Only `VITE_`-prefixed values reach the browser, and the only one needed there is the public Google client ID.
- **Environment template:** a committed `.env.local.example` documenting every variable and which side it belongs to.
- **Logging:** log every analysis with model, latency, token cost and resulting score — never image bytes — so prompt tuning can be evaluated against real spend.
- **Quality gates:** `npm run verify` — four strict typecheck projects, the Vitest suite, and the isolation audit — before every deploy. Vercel preview deployments per branch. The audit also fails the build if the endpoint list drifts from `api/`, or if the function count reaches Vercel Hobby's ceiling.
- **`vercel.json`** carries three decisions that are not self-evident, and cannot
  be commented in the file itself — Vercel validates the schema strictly and
  rejects an unknown `//` property:
  - **The SPA rewrite excludes `/api/`** via the negative lookahead in
    `/((?!api/).*)`. Without it an unregistered `/api/*` path returns
    `index.html` with status 200, the client's `res.json()` throws a syntax
    error, and the real problem — a missing route — is completely hidden. With
    it, Vercel's own 404 surfaces.
  - **`/api/*` is `no-store`.** Every API response is user-specific, and none is
    large enough for a cache to be worth any risk of serving one person's data
    to another.
  - **`regions` is pinned to `iad1`**, which must match the Neon project's region
    (`aws-us-east-1`). The HTTP driver's round-trip dominates most endpoints, so
    a mismatched pair degrades every screen. Pinned here rather than left to the
    dashboard default so the pairing is visible to a reviewer.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Cross-user data leak from a query missing its `user_id` | Single accessor file, `userId` always first and always in the `where`, grep audit (§4) |
| A bad prompt edit silently degrades all future scoring | `previous_body` one-click revert, version bump, fixture suite run after saving, cache invalidated by version |
| Score drift on unseen descriptions | `score_cache` for repeats, the step-by-step rubric, the three post-rules re-applied in our own code from model-returned booleans |
| The model returns a score inconsistent with its own factors | `domain/scoring.ts` owns the final integer; the model's number is an input, not the answer |
| LLM cost creep from re-scoring on every edit | One call per analysis, client-side compression, `score_cache`, durable daily cap in `ai_usage` |
| Vision model misreads hidden cooking fats | `is_homemade` supplied as context; the description is always editable and always re-scored |
| Timezone skew rejecting a legitimate "today" | Client-supplied local date plus `tz_offset_minutes`, DB constraint carries one day of slack |
| Endpoint list drift — 404 locally but fine in production | Endpoint names and server env keys listed in `tools/devApiPlugin.ts`, updated in the same commit as the handler, and checked by the audit |
| Session outliving a revoked user | Allowlist re-checked on every request with a 60-second cache |

---

## 11. Decisions worth recording

Points where more than one answer was defensible, kept here so the reasoning is
not re-litigated.

| Question | Decision |
|---|---|
| Allowlist precedence when an `ALLOWED_EMAILS` address is `blocked` in the DB | **The DB wins.** The env var grants only when no row exists, or when the query failed. The reverse would make the env var an un-revocable back door the admin UI could not close. |
| A `user_id` or a `score` in a request body | Request schemas are `.strict()`, so such a body is **rejected with a 400**. Silently dropping the field makes a client bug that tries to set a score look like it worked. |
| Where the AI budget is consumed | Read-only precheck in the handler; `consume()` inside `analyze()`, after a cache miss and immediately before the billable call. A cache hit must not cost quota. |
| `tz_offset_minutes` sign | **Minutes east of UTC** (UTC-3 is `-180`), matching ISO-8601 and the opposite of `Date.getTimezoneOffset()`. Asserted on both sides. |
| Storing photos | **No.** See §6: the description is the record, and an archive would cost an object store, four secrets and a function slot without changing a single score. |
| `Secure` on the session cookie | Only when deployed. Safari refuses `Secure` cookies on `http://localhost`, so setting it unconditionally makes local dev silently lose sessions in a way that looks like an auth bug. |
| Reasoning depth | `AI_EFFORT`, default `low`. See functional spec §9 for the latency measurements behind it. |
| Multiplexing methods in one `api/` file | Preferred to adding a file. Every `api/*.ts` is one Vercel function and Hobby allows twelve. |
