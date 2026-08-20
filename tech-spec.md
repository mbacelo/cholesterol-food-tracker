# Cholesterol Food Tracker, Technical Specification (v1.1)

Companion to `functional-spec.md`, which defines **what** the app does. This document defines **how** it is built.

> **Status: implemented.** Reconciled with the shipped code. Where a choice here
> turned out to be impossible, unavailable, or wrong on contact with the real
> platforms, it is corrected in place and marked *Reconciliation*. §12 lists every
> change and the verified dependency versions.

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
| Image storage | Cloudflare R2, private bucket, presigned GET URLs, via `aws4fetch` |
| Auth | Google Identity Services, server-verified once, then an httpOnly session cookie |
| AI | Multimodal models behind a provider interface, strict JSON schema output. **Two implemented**: Anthropic and OpenAI, plus a deterministic offline `mock` for tests |
| Validation | Zod, shared between request bodies and AI output parsing |
| Tests | Vitest on pure logic modules |
| Hosting | Vercel Hobby |

A Vite SPA plus serverless functions is chosen over a full-stack framework deliberately: every screen is authenticated, interactive and unindexable, so server rendering buys nothing and costs extra concepts. A managed Postgres and an object store, each behind one module, is less to learn and operate than an all-in-one backend platform.

### Cost

| Service | Tier | Notes |
|---|---|---|
| Vercel | Hobby | Free. Non-commercial use, which a personal app is. |
| Neon | Free | ~0.5 GB. The schema is text-only, so effectively unlimited here. |
| Cloudflare R2 | Free | ~10 GB storage, zero egress. Verify current limits at signup. |
| Google OAuth | Free | — |
| LLM provider | **Paid** | The only bill. §7 covers the four mechanisms that keep it small. |

---

## 2. Architecture

```
Phone browser — React SPA, PWA, installed to home screen
  │  fetch, httpOnly session cookie
  ▼
Vercel serverless functions  /api/*   (11 files; Vercel Hobby allows 12)
  ├── session      GET rehydrate · POST sign in · DELETE sign out
  ├── analyze      POST  image and/or text → description + score  (stateless, stores nothing)
  ├── entries      GET list/day/one · POST create · PATCH · DELETE
  ├── image        GET   → 302 to a presigned R2 URL
  ├── settings     GET · PATCH
  ├── summary      GET   → dashboard aggregates, computed in SQL
  ├── export       GET   → CSV
  └── admin/       ping (the probe) · allowlist · prompts · users
        │                     │                    │
        ▼                     ▼                    ▼
   Neon Postgres        Cloudflare R2           LLM API
   rows and text        photos, private         key stays server-side
```

### Security boundary

- **The browser never holds the AI key and never calls the model.** All analysis goes through `/api/analyze`.
- **The browser never holds R2 credentials.** It receives short-lived presigned URLs only.
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
  blob.ts               put / signedUrl / remove — the only file that knows about R2
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

`npm run dev` must serve the UI **and** `/api` together, so the real serverless handlers run in-process without a separate CLI. This is a small dev-only Vite plugin that reads `.env.local` for server env, exposes only `VITE_`-prefixed vars to the browser, and maps `/api/<name>` to the corresponding handler module. Two lists in `vite.config.ts` — the server env keys the handlers read, and the endpoint names — must be updated in the same commit that adds an endpoint, or the route 404s locally while working in production.

Files under `api/` and `lib/` import with explicit `.js` ESM specifiers (`./types.js`) even though sources are `.ts`, as Node ESM resolution on Vercel requires. Frontend files use extensionless imports. Path alias `@/*` maps to the repo root.

Scripts: `dev`, `build`, `preview`, `typecheck` (`tsc --noEmit`, strict), `test` (`vitest run`).

---

## 3. Database

Neon Postgres over the HTTP serverless driver, so no connection pooler is needed. Raw tagged-template SQL, no ORM: the schema is small enough that an ORM adds indirection without removing work.

Schema changes go in numbered files under `db/migrations/`, applied by hand in the Neon SQL editor. No runtime auto-creation of tables — with an evolving schema, silently creating a stale table is worse than failing loudly.

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
  image_key   text,                              -- R2 object key, never a URL
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
  email text, day date, calls int not null default 0,
  primary key (email, day)
);

-- Scoring cache. Also the determinism guarantee — see §7.
create table score_cache (
  hash       text primary key,  -- sha256(normalized description | homemade | prompt versions)
  result     jsonb not null,
  created_at timestamptz not null default now()
);
```

Notes:

- Factor lists are `jsonb` rather than a child table: they are display-only, always read with their entry, never queried independently.
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
4. **Administrators cannot reach food data.** Admin endpoints touch `food_entries` only via `count(*)` and `delete`. No admin response can carry a description, image key, score or rationale. User deletion is `delete from users where id = ...` (cascade) plus an R2 prefix delete.
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

Cloudflare R2, private bucket. Objects are private by default and egress is free, which suits photos that must never be publicly reachable and are viewed repeatedly.

Only `lib/server/blob.ts` knows the store exists, behind `put(key, bytes, contentType)`, `signedUrl(key, ttl)` and `remove(prefix)`. Changing providers later is a one-file change.

- **Key layout:** `{user_id}/{entry_id}.jpg`. Ownership is verified in Postgres before any URL is signed, so the prefix is organizational, not a security control.
- **Compression is client-side.** A canvas downscale to max 1280 px at JPEG quality ~0.7 yields roughly 200–400 KB while preserving enough detail to identify a dish. The original file is never uploaded. The server independently validates MIME type against an allowlist and checks decoded size against a 3.5 MB cap, with a body-parser limit of **4 MB**, because the body is buffered before any size check runs.

> **Reconciliation (v1.1).** The 5 MB figure is unreachable: Vercel hard-caps a
> request payload at **4.5 MB** (`413 FUNCTION_PAYLOAD_TOO_LARGE`) before a
> handler runs. A 5 MB local limit would accept requests production rejects, so
> both are 4 MB. The 3.5 MB decoded cap is unchanged, and is checked against the
> **magic bytes** rather than the declared content type — a content type is only a
> claim.
- **Serving:** `GET /api/image?entry=<id>` authenticates, confirms the row belongs to the caller, then `302`s to a presigned URL with a 5-minute TTL. A plain `<img src>` works with no client JavaScript.
- **Upload timing:** `/api/analyze` is stateless and stores nothing. The client keeps the compressed image and includes it in `POST /api/entries`, which writes the object and inserts the row. This sends ~300 KB twice, and in exchange there is no orphaned-object sweeper and no temporary-key lifecycle — and a discarded analysis is correct by construction, because no save path exists for it to reach accidentally.
- **Deletion:** deleting an entry removes its object; deleting a user removes the whole `{user_id}/` prefix.

---

## 7. AI scoring

Providers sit behind an `AIProvider` interface with one switch point, `getProvider()`, keyed off `AI_PROVIDER`; the model id is `AI_MODEL`. Only one provider is implemented; adding another means one file plus one `case`. Prompts and output shape are shared, so all providers extract identically.

Both prompts are loaded from the `prompts` table at request time, never from code, so administrator edits take effect immediately and apply to future analyses only. Saving a prompt copies the old body into `previous_body` and bumps `version`; **Revert** swaps them back. That one column is the whole safety net for a bad prompt edit.

**One call per analysis.** `analyze({ image?, description?, isHomemade })` makes a single model request and returns `{ description, score, rationale, positive_factors, negative_factors, has_trans_fat, whole_plant_only, food_detected }` using the provider's strict JSON-schema mode, re-validated with Zod.

- The system prompt is `scoring_prompt`, with `image_analysis_prompt` prepended only when an image is attached.
- With an image, the model produces the description. With typed text, the user's text **is** the description and the model must not rewrite it, which keeps the cache key stable.
- The result then passes through `domain/scoring.ts`, which re-applies the proxy cap, the trans-fat cap, the whole-plant floor and the clamp **in our own code**, using the two booleans. The model proposes; our code decides the final integer.
- `food_detected: false` drives the specified fallback: keep the photo, ask the user to type a description.
- Invalid output is retried once, then surfaces a clear error. Nothing is saved without a valid score.

Collapsing the old image→description then description→score pair into one call halves both the latency and the cost of the primary path, and removes an intermediate state that had no user-visible value.

**The score is never accepted from the client.** `POST /api/entries` takes only `{ description, is_homemade, entry_date, tz_offset_minutes, image? }`. This closes "no interface anywhere lets a user alter a score" at the protocol level rather than by hiding an input.

**Re-scoring** is decided in one function in `lib/server/entries.ts`: a PATCH whose `description` or `is_homemade` differs from the stored row re-scores before committing; a date-only change does not.

**Quick check** is not a code path. `/api/analyze` writes nothing, so an analysis the user discards leaves no trace, and "save as entry" is an ordinary create.

### Determinism

The functional spec requires that the same description scored twice differ by no more than one point. Three mechanisms, strongest first:

1. **`score_cache`, keyed on `sha256(normalized_description | is_homemade | prompt_versions)`.** A repeat returns a byte-identical result — a zero-point difference — and costs nothing. This covers review-screen editing and everyday repeated dishes. A photo analysis writes its result into the cache under the description it produced, so a later identical description hits it. Including the prompt versions means an administrator's edit invalidates the cache naturally, while existing entries keep their stored scores, exactly as the non-retroactivity rule requires.
2. **`temperature: 0` where the provider still accepts it**, plus a rubric prompt that accumulates modifiers step by step, for inputs never seen before.

   > **Reconciliation (v1.1).** `temperature`, `top_p` and `top_k` were **removed
   > from current Anthropic models and are rejected with a 400**. So this
   > mechanism exists on the OpenAI path only. On Anthropic, determinism rests on
   > `score_cache` (mechanism 1, which gives a *zero*-point difference, better than
   > the 1 point the functional spec allows) and on the step-by-step rubric
   > (mechanism 3). The provider interface therefore does not expose temperature at
   > all; each provider decides internally.
3. **A Vitest suite of ~30 fixed descriptions** asserting each lands in an expected band, plus unit tests for the three post-rules in `domain/scoring.ts`. Run it after every prompt edit; it is the regression net for the riskiest acceptance criterion in the spec.

### Cost control

Four layers: one call instead of two on the photo path; client-side compression to cut image tokens; `score_cache` to make repeat scoring free; and `ai_usage` for a durable per-user daily cap in Postgres. A small in-memory per-email limiter additionally absorbs bursts, but it is not the budget — it resets on every cold start, and this app calls the model on every new entry *and* every description edit.

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
- **In-progress capture is persisted** to localStorage: the compressed image on its own key, since it is large and changes once per photo, and the description plus analysis result on another. Both stamped with a `SESSION_VERSION` bumped whenever the persisted shape changes, so stale data is discarded rather than rehydrated. A mobile refresh mid-review must not force a second paid call. Restored only into the review step, never the analyzing step.
- **PWA:** manifest plus icons so it installs to the home screen, with `name: "Cholesterol Food Tracker"` and `short_name: "Cholesterol"` so the icon label is not truncated. No offline write queue, since logging needs the model, so show a clear offline state instead.
- **Export:** a serverless endpoint streams CSV with `Content-Disposition: attachment`.

---

## 9. Operations

- **Secrets** (`OPENAI_API_KEY`, `AI_PROVIDER`, `AI_MODEL`, `R2_*`, `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `DATABASE_URL`, `ALLOWED_EMAILS`, `ADMIN_EMAILS`, `DEBUG_AUTH`, `DEBUG_ADMIN`) are server-only env vars. Only `VITE_`-prefixed values reach the browser, and the only one needed there is the public Google client ID.
- **Environment template:** a committed `.env.local.example` documenting every variable and which side it belongs to.
- **Logging:** log every analysis with model, latency, token cost and resulting score — never image bytes — so prompt tuning can be evaluated against real spend.
- **Quality gates:** `npm run typecheck` (strict) and `npm test` before every deploy. Vercel preview deployments per branch.

---

## 10. Build order

1. Vite + React + Tailwind scaffold, the dev API plugin, `tsconfig` strict, `.env.local.example`.
2. Neon project, `001_init.sql`, seed both prompts and the owner's allowlist row. Debug-mode module.
3. Session cookie auth, allowlist gate, user provisioning. Verify that a blocked email is refused.
4. `domain/scoring.ts` and `domain/aggregation.ts` with their Vitest suites — **before any UI**. These are the rules that must not regress.
5. Text logging end-to-end: `/api/analyze` → review screen → `POST /api/entries`. Today screen.
6. R2 bucket and `lib/server/blob.ts`. Photo logging: compress, analyze, save, `/api/image`, plus the unrecognized-food fallback. Quick check needs no work beyond Discard.
7. History, entry detail, edit with re-score, delete.
8. Dashboard aggregates and both charts.
9. Me: settings, rubric reference page, CSV export.
10. Admin: allowlist management, user deletion by count only, prompt editor with revert.
11. Hardening: `score_cache`, `ai_usage`, rate limits, the fixed-description fixture suite, PWA manifest, the `grep food_entries api/` audit.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Cross-user data leak from a query missing its `user_id` | Single accessor file, `userId` always first and always in the `where`, grep audit (§4) |
| A bad prompt edit silently degrades all future scoring | `previous_body` one-click revert, version bump, fixture suite run after saving, cache invalidated by version |
| Score drift on unseen descriptions | `score_cache` for repeats, `temperature: 0`, the three post-rules re-applied in our own code from model-returned booleans |
| The model returns a score inconsistent with its own factors | `domain/scoring.ts` owns the final integer; the model's number is an input, not the answer |
| LLM cost creep from re-scoring on every edit | One call per analysis, client-side compression, `score_cache`, durable daily cap in `ai_usage` |
| Vision model misreads hidden cooking fats | `is_homemade` supplied as context; the description is always editable and always re-scored |
| Timezone skew rejecting a legitimate "today" | Client-supplied local date plus `tz_offset_minutes`, DB constraint carries one day of slack |
| Endpoint list drift — 404 locally but fine in production | Endpoint names and server env keys listed in `vite.config.ts`, updated in the same commit as the handler |
| Session outliving a revoked user | Allowlist re-checked on every request with a 60-second cache |

---

## 12. Changes in v1.1 (reconciliation with the implementation)

### Corrections forced by the platforms

| § | v1 said | Reality | Resolution |
|---|---|---|---|
| 6 | 5 MB body-parser limit | Vercel hard-caps a payload at 4.5 MB before the handler runs | 4 MB in both dev and prod, so they refuse the same requests |
| 7 | `temperature: 0` as determinism mechanism 2 | `temperature`/`top_p`/`top_k` are **removed** from current Anthropic models and return a 400 | Mechanism applies on the OpenAI path only; the provider interface does not expose temperature |
| 2 | Two lists in `vite.config.ts` | Fine, but the CI audit needs the same source of truth | Lists live in `tools/devApiPlugin.ts`; `scripts/audit-isolation.mjs` reads them and fails the build on drift |
| 2 | `tsc --noEmit` strict across both halves | TypeScript 7 makes `baseUrl` a hard error; Vercel supports neither `paths` nor project references and reads the **root** tsconfig when compiling `api/` | Root tsconfig **is** the browser project; the server project omits `paths`, which turns an `@/` import in server code into a compile error |
| 3 | `create extension pgcrypto` | Not in PGlite's base bundle, so the local fallback could not run the migration | Loaded as a PGlite contrib extension, so migrations run locally byte-for-byte as in Neon |
| — | Not mentioned | Vercel Hobby allows **12 functions**; every `api/*.ts` is one | 11 used; the audit fails the build at 13, and methods are multiplexed inside a file rather than adding one |

### Endpoints added beyond §2's list

Three, each because the rest of the spec required something the list omitted.

- **`GET /api/session`** — the SPA must learn on load whether it has a session. §5
  described only POST and DELETE, which would force the client to infer identity
  from the settings endpoint and could not distinguish "not signed in" from "not
  authorized".
- **`GET /api/summary`** — §8 mandates aggregating in SQL, but no endpoint existed
  to do it. The alternative, shipping 90 days of entries to compute eleven bar
  heights, contradicts §8 and widens what leaves the server for no gain.
- **`GET /api/admin/ping`** — the §5 admin probe. Probing `admin/allowlist` would
  run a query for an answer we discard and couple the probe to a data shape.

### Modules added beyond §2's layout

`errors.ts`, `http.ts`, `env.ts`, `users.ts`, `admins.ts`, `scoreCache.ts`,
`requests.ts`, `dates.ts`, `csv.ts`. Each exists because handlers may contain no
SQL and no business rule, and the spec's layout left those homeless. `admins.ts`
is separate from `session.ts` only to break an import cycle.

### Schema changes

- `ai_usage` key columns are `not null`; two housekeeping indexes added.
- `schema_migrations` added: migrations are applied by hand, so a record of what a
  given database has seen is the only way to know.
- **`score_cache.result` stores the validated model output, not the final score,
  and deliberately omits nothing else that identifies a person.** Storing the
  output means a fix in `domain/scoring.ts` reaches cached rows without a purge.
  The table is keyed by hash and is **not user-scoped**, which was the one privacy
  seam in an otherwise strictly isolated schema.
- Seeds live in `002_seed_prompts.sql`, **generated** from
  `lib/ai/prompts/defaults.ts` by `scripts/generate-seed.mjs`, dollar-quoted
  because the rubric is full of apostrophes. The owner's allowlist row is not
  seeded: `ALLOWED_EMAILS` is the bootstrap, and a personal address does not
  belong in a committed migration.

### Decisions the spec left open

| Question | Decision |
|---|---|
| Allowlist precedence when an `ALLOWED_EMAILS` address is `blocked` in the DB | **The DB wins.** The env var grants only when no row exists, or when the query failed. The reverse would make the env var an un-revocable back door the admin UI could not close. |
| "A `user_id` in a request body is ignored" | Request schemas are `.strict()`, so such a body is **rejected with a 400**. Silently dropping it makes a client bug that tries to set a score look like it worked. |
| Where the AI budget is consumed | Read-only precheck in the handler; `consume()` inside `analyze()`, after a cache miss and immediately before the billable call. A cache hit must not cost quota. |
| `tz_offset_minutes` sign | **Minutes east of UTC** (UTC-3 is `-180`), matching ISO-8601 and the opposite of `Date.getTimezoneOffset()`. Asserted on both sides. |
| Image transport | Base64 in JSON. The runtime parses JSON for free and no multipart, one Zod schema validates the whole body, and ~400 KB becomes ~547 KB — well inside the 4 MB limit. |
| `Secure` on the session cookie | Only when deployed. Safari refuses `Secure` cookies on `http://localhost`, so setting it unconditionally makes local dev silently lose sessions in a way that looks like an auth bug. |
| Reasoning depth | `AI_EFFORT`, default `low`. See functional spec §9 for the latency measurements behind it. |

### Verified dependency versions

React 19.2.8 · Vite 8.2.1 · TypeScript 7.0.2 · Tailwind 4.3.3 · react-router 7.18.2 ·
Recharts 3.10.1 · Zod 4.4.3 · `@neondatabase/serverless` 1.1.0 · jose 6.2.9 ·
google-auth-library 11.0.2 · `@anthropic-ai/sdk` 0.119.0 · openai 7.5.0 ·
aws4fetch 1.0.20 · Vitest 4.1.11 · PGlite 0.5.5 (dev only) · Node 24.

`@vercel/node` is **not** a dependency: the handler contract is ~20 lines in
`lib/server/http.ts`, which avoids a dev dependency with high-severity advisories
in production code's type surface.

### What is verified, and what is not

Verified locally with no cloud accounts, plus a real Anthropic key: 209 unit and
integration tests, four strict typecheck projects, the isolation audit, a
production build, every endpoint driven end to end, and the five screens driven in
a browser at 390×844.

**Not yet exercised:** real Google sign-in, Neon, R2, and a Vercel deployment —
all four need credentials this build does not have. The code paths exist and are
typechecked; they have not been run against the live services.
