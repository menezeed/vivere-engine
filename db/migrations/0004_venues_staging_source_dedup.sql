-- ============================================================
-- Migration 0004 — Idempotência cross-run em venues_staging
--
-- PROBLEMA IDENTIFICADO:
-- A constraint UNIQUE(raw_venue_item_id) em venues_staging aponta
-- para o id gerado em raw_venue_items — que é diferente a cada
-- IngestionRun. Resultado: o mesmo venue físico entra em staging
-- múltiplas vezes se a ingestão rodar mais de uma vez.
--
-- SOLUÇÃO:
-- Adicionar source_key e source_item_id diretamente em
-- venues_staging e usar UNIQUE(source_key, source_item_id,
-- product_key) como constraint de deduplicação cross-run.
-- O mesmo venue de uma fonte nunca entra duas vezes em staging
-- para o mesmo produto, independente de quantas runs rodarem.
--
-- A constraint anterior (raw_venue_item_id_unique) é mantida
-- como integridade referencial, mas não é mais a garantia
-- de deduplicação principal.
-- ============================================================

-- Adicionar colunas de identificação da fonte
ALTER TABLE staging.venues_staging
  ADD COLUMN source_key    text,
  ADD COLUMN source_item_id text;

-- Preencher com NOT NULL depois de popular (tabela está vazia em dev)
ALTER TABLE staging.venues_staging
  ALTER COLUMN source_key    SET NOT NULL,
  ALTER COLUMN source_item_id SET NOT NULL;

-- Adicionar FK para public.sources
ALTER TABLE staging.venues_staging
  ADD CONSTRAINT venues_staging_source_key_fkey
  FOREIGN KEY (source_key) REFERENCES public.sources(source_key);

-- Constraint de idempotência cross-run
-- Remove a antiga baseada em raw_venue_item_id se ainda existir
ALTER TABLE staging.venues_staging
  DROP CONSTRAINT IF EXISTS venues_staging_raw_venue_item_id_unique;

ALTER TABLE staging.venues_staging
  ADD CONSTRAINT venues_staging_source_dedup_unique
  UNIQUE (source_key, source_item_id, product_key);
