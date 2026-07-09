-- ============================================================
-- Rollback 0016 — remover FKs promoted_*_id de staging
-- ============================================================

ALTER TABLE staging.venues_staging
  DROP CONSTRAINT IF EXISTS fk_promoted_venue_id;

ALTER TABLE staging.activities_staging
  DROP CONSTRAINT IF EXISTS fk_promoted_activity_id;
