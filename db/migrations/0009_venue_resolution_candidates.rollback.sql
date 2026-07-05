-- Rollback de 0009_venue_resolution_candidates.sql
-- ATENÇÃO: apaga todos os candidatos de resolução.
-- Só executar se 0010 já tiver sido revertida.
DROP INDEX IF EXISTS staging.venue_resolution_candidates_pending_idx;
DROP INDEX IF EXISTS staging.venue_resolution_candidates_score_idx;
DROP INDEX IF EXISTS staging.venue_resolution_candidates_product_idx;
DROP INDEX IF EXISTS staging.venue_resolution_candidates_run_idx;
DROP INDEX IF EXISTS staging.venue_resolution_candidates_activity_idx;
DROP TABLE IF EXISTS staging.venue_resolution_candidates;
