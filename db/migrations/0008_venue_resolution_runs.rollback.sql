-- Rollback de 0008_venue_resolution_runs.sql
-- ATENÇÃO: apaga todos os dados de runs de resolução.
-- Só executar se 0009 e 0010 já tiverem sido revertidas (dependem desta tabela via FK).
DROP INDEX IF EXISTS staging.venue_resolution_runs_status_idx;
DROP INDEX IF EXISTS staging.venue_resolution_runs_product_started_idx;
DROP TABLE IF EXISTS staging.venue_resolution_runs;
