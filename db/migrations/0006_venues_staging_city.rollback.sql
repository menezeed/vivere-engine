-- Rollback de 0006_venues_staging_city.sql
DROP INDEX IF EXISTS staging.venues_staging_product_city_idx;
ALTER TABLE staging.venues_staging DROP COLUMN IF EXISTS city;
