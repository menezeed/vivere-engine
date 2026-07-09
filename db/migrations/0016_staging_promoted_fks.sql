-- ============================================================
-- Migration 0016 — staging promoted FKs
--
-- ⚠️  EXECUÇÃO ADIADA — NÃO APLICAR AINDA ⚠️
--
-- Este script está versionado na Sprint 8.1 mas só deve ser
-- executado na Sprint 8.7, após:
--   1. Primeira publicação real pelo Publishing Engine
--   2. Validação de que promoted_venue_id em venues_staging
--      aponta para UUIDs válidos em public.venues
--   3. Validação de que promoted_activity_id em activities_staging
--      aponta para UUIDs válidos em public.activities
--
-- PORQUÊ ADIADO:
-- ADD CONSTRAINT com FOREIGN KEY valida TODOS os valores existentes.
-- Se promoted_venue_id contiver UUIDs que não existem em public.venues,
-- o ADD CONSTRAINT falha. Antes da Sprint 8.7 esses campos são NULL
-- (nunca publicados) — a FK seria OK nesse estado, mas é mais seguro
-- executar com dados reais para confirmar consistência end-to-end.
--
-- ROLLBACK: ver 0016_staging_promoted_fks.rollback.sql
-- ============================================================

-- FK: venues_staging.promoted_venue_id → public.venues.id
ALTER TABLE staging.venues_staging
  ADD CONSTRAINT IF NOT EXISTS fk_promoted_venue_id
    FOREIGN KEY (promoted_venue_id)
    REFERENCES public.venues (id)
    ON DELETE SET NULL;

-- FK: activities_staging.promoted_activity_id → public.activities.id
ALTER TABLE staging.activities_staging
  ADD CONSTRAINT IF NOT EXISTS fk_promoted_activity_id
    FOREIGN KEY (promoted_activity_id)
    REFERENCES public.activities (id)
    ON DELETE SET NULL;

COMMENT ON CONSTRAINT fk_promoted_venue_id ON staging.venues_staging IS
  'FK para o registo publicado em public.venues. '
  'Adicionada na Sprint 8.7 após validação da primeira publicação real.';

COMMENT ON CONSTRAINT fk_promoted_activity_id ON staging.activities_staging IS
  'FK para o registo publicado em public.activities. '
  'Adicionada na Sprint 8.7 após validação da primeira publicação real.';
