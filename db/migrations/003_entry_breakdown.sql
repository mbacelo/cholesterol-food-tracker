-- The inputs domain/scoring.ts turns into the stored score.
--
-- `score` alone is a verdict: nothing in the app could show a user how it was
-- reached. These five columns are exactly the ScoreInputs finalizeScore takes,
-- so a screen can re-derive the ordered rule steps client-side rather than
-- persist prose that would then have to be kept in step with the rules.
--
-- Nullable on purpose. Entries logged before this migration have no breakdown
-- and never will -- their scores are not recomputed -- so the UI renders the
-- section only when modifier_sum is present.
alter table food_entries
  -- The model's raw running total, deliberately unclamped: it may fall outside
  -- -5..+5, which is the whole point of storing it next to the final score.
  add column modifier_sum           int,
  add column has_trans_fat          boolean,
  add column whole_plant_only       boolean,
  add column proxy_ultra_processed  boolean,
  add column proxy_unidentified_fat boolean;

insert into schema_migrations (version) values ('003_entry_breakdown');
