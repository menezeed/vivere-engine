-- Rollback de 0007_venues_staging_name_search.sql
DROP INDEX IF EXISTS staging.venues_staging_name_trgm_idx;
DROP INDEX IF EXISTS staging.venues_staging_product_status_idx;
DROP INDEX IF EXISTS staging.venues_staging_source_key_idx;
ALTER TABLE staging.venues_staging DROP COLUMN IF EXISTS name;
