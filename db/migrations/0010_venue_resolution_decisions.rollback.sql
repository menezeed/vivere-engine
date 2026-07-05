-- Rollback de 0010_venue_resolution_decisions.sql
-- Remove a FK adicionada em candidates, depois a tabela decisions.
ALTER TABLE staging.venue_resolution_candidates
  DROP CONSTRAINT IF EXISTS fk_candidate_decision;

DROP INDEX IF EXISTS staging.venue_resolution_decisions_overrides_idx;
DROP INDEX IF EXISTS staging.venue_resolution_decisions_user_idx;
DROP INDEX IF EXISTS staging.venue_resolution_decisions_product_idx;
DROP INDEX IF EXISTS staging.venue_resolution_decisions_activity_idx;
DROP TABLE IF EXISTS staging.venue_resolution_decisions;
