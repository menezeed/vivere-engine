-- ============================================================
-- Rollback 0021 — remover staging.venues_staging.geographic_status
--
-- AVISO: NÃO EXECUTAR EM PRODUÇÃO. Apaga a coluna e todos os valores
-- que lá estejam (a classificação geográfica das venues em staging).
-- Só se aplica a um ambiente reconstruído da cadeia (ex: staging) onde
-- a 0021 criou a coluna.
-- ============================================================

ALTER TABLE staging.venues_staging
  DROP CONSTRAINT IF EXISTS venues_staging_geographic_status_check;

ALTER TABLE staging.venues_staging
  DROP COLUMN IF EXISTS geographic_status;
