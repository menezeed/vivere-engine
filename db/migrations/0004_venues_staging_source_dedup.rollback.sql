-- Rollback de 0004_venues_staging_source_dedup.sql
ALTER TABLE staging.venues_staging
  DROP CONSTRAINT IF EXISTS venues_staging_source_dedup_unique;

ALTER TABLE staging.venues_staging
  DROP CONSTRAINT IF EXISTS venues_staging_source_key_fkey;

ALTER TABLE staging.venues_staging
  ADD CONSTRAINT venues_staging_raw_venue_item_id_unique
  UNIQUE (raw_venue_item_id);

ALTER TABLE staging.venues_staging
  DROP COLUMN IF EXISTS source_key,
  DROP COLUMN IF EXISTS source_item_id;
