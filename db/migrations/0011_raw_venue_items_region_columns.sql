-- ============================================================
-- Migration 0011 — staging.raw_venue_items region columns
--
-- CONTEXTO:
-- As colunas source_region_label e source_region_key foram adicionadas
-- manualmente via ALTER TABLE durante a Sprint 7.10 (ingestão direccionada).
-- Esta migration formaliza essa alteração no versionamento.
--
-- SEGURANÇA:
-- Usa IF NOT EXISTS — idempotente se as colunas já existirem.
-- Não altera dados existentes. Linhas antigas ficam com NULL nas colunas
-- (comportamento aceitável — a city é derivada de source_region_label
-- apenas para venues novos; existentes têm city preenchida via migration 0006).
--
-- APLICAR:
-- Executar no Supabase SQL Editor.
-- Confirmar que raw_venue_items continua a aceitar INSERT após a migration.
-- ============================================================

ALTER TABLE staging.raw_venue_items
  ADD COLUMN IF NOT EXISTS source_region_label TEXT,
  ADD COLUMN IF NOT EXISTS source_region_key   TEXT;

COMMENT ON COLUMN staging.raw_venue_items.source_region_label IS
  'Label legível da região de origem da query (ex: "Cabo Frio RJ"). '
  'Usado para popular venues_staging.city via VenueStagingRepository.';

COMMENT ON COLUMN staging.raw_venue_items.source_region_key IS
  'Chave interna da região (ex: "cabo_frio_targeted"). '
  'Permite rastrear de qual região config a linha foi ingerida.';

-- Criar índice para queries por região (útil para observabilidade)
CREATE INDEX IF NOT EXISTS raw_venue_items_region_label_idx
  ON staging.raw_venue_items (source_region_label)
  WHERE source_region_label IS NOT NULL;
