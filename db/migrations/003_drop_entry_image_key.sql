-- 003_drop_entry_image_key.sql -- photos are no longer stored.
--
-- Applied by hand in the Neon SQL editor, like every migration here.
--
-- A photo is now input to /api/analyze and nothing else: it is compressed on the
-- device, read by the model, shown while the Log screen is open, and discarded.
-- The description is the record. This removes the object store, its four
-- secrets, the presigned-URL endpoint and the two blob-deletion paths.
--
-- ONE MANUAL STEP: this drops the only record of which objects exist, so empty
-- the R2 bucket BEFORE or right after applying it. The code that could delete
-- those objects by key is removed in the same change, so afterwards the bucket
-- can only be cleared from the Cloudflare dashboard.

alter table food_entries drop column image_key;

insert into schema_migrations (version) values ('003_drop_entry_image_key');
