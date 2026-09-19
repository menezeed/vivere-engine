-- ============================================================
-- Migration 0016 — staging promoted FKs
--
-- Aplicada na Sprint 8.7, após:
--   1. Primeira publicação real pelo Publishing Engine (Run 96e54953..., success)
--   2. Segunda execução validando idempotência (Run 9f0ccdd0..., success)
--   3. Verificação de integridade referencial (zero linhas órfãs em
--      venues_staging.promoted_venue_id e activities_staging.promoted_activity_id)
--
-- CORRECÇÃO (revisão pré-aplicação, Sprint 8.7):
-- A versão original usava `ADD CONSTRAINT IF NOT EXISTS`, que NÃO é
-- sintaxe válida em PostgreSQL (ao contrário de ADD COLUMN IF NOT EXISTS
-- ou CREATE INDEX IF NOT EXISTS) — a migration falhava sempre com
-- "syntax error at or near NOT". Substituído por um bloco DO $$ que
-- verifica pg_constraint antes de adicionar, preservando a idempotência
-- pretendida.
--
-- ROLLBACK: ver 0016_staging_promoted_fks.rollback.sql
-- ============================================================

-- FK: venues_staging.promoted_venue_id → public.venues.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_promoted_venue_id'
  ) THEN
    ALTER TABLE staging.venues_staging
      ADD CONSTRAINT fk_promoted_venue_id
        FOREIGN KEY (promoted_venue_id)
        REFERENCES public.venues (id)
        ON DELETE SET NULL;
  END IF;
END $$;

-- FK: activities_staging.promoted_activity_id → public.activities.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_promoted_activity_id'
  ) THEN
    ALTER TABLE staging.activities_staging
      ADD CONSTRAINT fk_promoted_activity_id
        FOREIGN KEY (promoted_activity_id)
        REFERENCES public.activities (id)
        ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON CONSTRAINT fk_promoted_venue_id ON staging.venues_staging IS
  'FK para o registo publicado em public.venues. '
  'Adicionada na Sprint 8.7 após validação da primeira publicação real.';

COMMENT ON CONSTRAINT fk_promoted_activity_id ON staging.activities_staging IS
  'FK para o registo publicado em public.activities. '
  'Adicionada na Sprint 8.7 após validação da primeira publicação real.';