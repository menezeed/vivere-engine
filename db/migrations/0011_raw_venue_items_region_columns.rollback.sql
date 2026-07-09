-- ============================================================
-- Rollback 0011 — remover colunas source_region_* de raw_venue_items
--
-- ATENÇÃO: este rollback remove dados de região de todos os venues.
-- Executar apenas se necessário reverter a migration 0011.
-- ============================================================

DROP INDEX IF EXISTS staging.raw_venue_items_region_label_idx;

ALTER TABLE staging.raw_venue_items
  DROP COLUMN IF EXISTS source_region_label,
  DROP COLUMN IF EXISTS source_region_key;
