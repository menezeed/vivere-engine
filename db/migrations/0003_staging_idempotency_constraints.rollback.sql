-- Rollback de 0003_staging_idempotency_constraints.sql
alter table staging.venues_staging
  drop constraint if exists venues_staging_raw_venue_item_id_unique;

alter table staging.activities_staging
  drop constraint if exists activities_staging_raw_activity_item_id_unique;
