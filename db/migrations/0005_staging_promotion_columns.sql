-- ============================================================
-- Migration 0005 — Colunas de promoção em staging
--
-- Adiciona promoted_at a venues_staging e activities_staging.
-- Estas colunas foram identificadas como necessárias durante
-- a validação da Human Review API (Fase 5).
--
-- promoted_at: timestamp de quando o item foi marcado como promoted
-- promoted_venue_id / promoted_activity_id: uuid nullable sem FK
-- (Opção A — promoção fictícia, ADR-0009). Receberão FK quando
-- o Caminho B (migration de convergência) for executado.
-- ============================================================

ALTER TABLE staging.venues_staging
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

ALTER TABLE staging.activities_staging
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;
