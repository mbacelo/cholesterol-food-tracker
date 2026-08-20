-- 001_init.sql -- schema, from tech spec §3.
--
-- Applied by hand in the Neon SQL editor. There is no runtime auto-creation of
-- tables: with an evolving schema, silently creating a stale table is worse than
-- failing loudly. (Locally, lib/server/db.ts applies this file to its in-process
-- PGlite database, which is a throwaway dev store, not a deployed environment.)

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
  -- A backstop with one day of slack, so a client an hour ahead of UTC is never
  -- rejected by the constraint instead of by validation. The user's actual
  -- "no future dates" rule is enforced against their tz_offset_minutes.
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
-- Serves both the Today lookup and the History keyset page.
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

-- Scoring cache. Also the determinism guarantee -- see §7.
--
-- `result` stores the VALIDATED MODEL OUTPUT, not the final score, so a fix in
-- domain/scoring.ts reaches cached rows without a purge. It deliberately omits
-- the description: this table is global and not user-scoped, so keeping food
-- text out of it is what stops it becoming a cross-user record of what people
-- ate. The description is already the hash input, and the caller always has it.
create table score_cache (
  hash       text primary key,  -- sha256(key schema | provider | model | prompt versions | homemade | normalized description)
  result     jsonb not null,
  created_at timestamptz not null default now()
);
create index score_cache_created_at_idx on score_cache (created_at);

-- Which migrations have been applied. The spec applies these by hand, so this is
-- the only record of what a given database has actually seen.
create table schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

insert into schema_migrations (version) values ('001_init');
