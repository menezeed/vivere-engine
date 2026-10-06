-- ============================================================
-- Migration 0021 — staging.venues_staging.geographic_status
--
-- CONTEXTO (ADR-0022, Phase D / N3):
-- A produção já tem esta coluna e a sua CHECK (assinatura de schema da
-- produção, 04/10/2026), e o código depende dela: VenueStagingRepository
-- escreve-a, VenueReviewRepository lê-a e filtra por ela, e
-- PublishableVenueRepository usa-a no filtro de publicação
-- (geographic_status nulo ou diferente de 'outside_region').
-- Nenhuma migração 0000-0020 a cria (a ADR-0022 regista a proveniência
-- como pendência de schema-as-code). Um ambiente reconstruído da cadeia
-- ficaria sem a coluna e a ingestão e a publicação falhariam com
-- "coluna não encontrada". Esta migração captura em db/migrations
-- exactamente a definição que a produção tem.
--
-- CONTRATO (produção, assinatura N3.1):
--   staging.venues_staging.geographic_status
--   tipo text, NULL permitido, sem default (posição 14, a última)
--   CHECK venues_staging_geographic_status_check:
--     geographic_status IS NULL
--     OR geographic_status IN ('inside_radius', 'buffer_zone', 'outside_region')
--   Sem índice, sem FK, sem UNIQUE sobre a coluna.
--
-- IF NOT EXISTS (contrato forward-only do README): usado aqui porque a
-- incerteza é genuína por desenho. Um ambiente criado do histórico real
-- de produção já tem a coluna; um ambiente reconstruído da cadeia não.
-- Em produção seria um no-op, mas não deve ser executada lá sem
-- autorização própria.
--
-- NATUREZA: aditiva. Sem dados, sem DROP, sem DEFAULT.
-- ROLLBACK: ver 0021_venues_staging_geographic_status.rollback.sql
-- (NÃO usar em produção: apaga a coluna e os seus dados).
-- ============================================================

ALTER TABLE staging.venues_staging
  ADD COLUMN IF NOT EXISTS geographic_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venues_staging_geographic_status_check'
      AND conrelid = 'staging.venues_staging'::regclass
  ) THEN
    ALTER TABLE staging.venues_staging
      ADD CONSTRAINT venues_staging_geographic_status_check
      CHECK (geographic_status IS NULL
             OR geographic_status = ANY (ARRAY['inside_radius'::text, 'buffer_zone'::text, 'outside_region'::text]));
  END IF;
END $$;
