-- Rollback de 0005_staging_promotion_columns.sql
ALTER TABLE staging.venues_staging DROP COLUMN IF EXISTS promoted_at;
ALTER TABLE staging.activities_staging DROP COLUMN IF EXISTS promoted_at;
