-- ============================================================
-- Rollback 0012 — remover engine fields de public.venues
--
-- ATENÇÃO: este rollback remove os campos da engine de public.venues.
-- Os dados nos campos originais (name, address, lat, lng, etc.)
-- são preservados integralmente.
--
-- Executar apenas para reverter a migration 0012.
-- Se existirem venues publicados pela engine, engine_venue_id em
-- staging.venues_staging ficará sem referência válida — limpar
-- manualmente após o rollback se necessário.
-- ============================================================

ALTER TABLE public.venues
  DROP COLUMN IF EXISTS engine_venue_id,
  DROP COLUMN IF EXISTS source_key,
  DROP COLUMN IF EXISTS product_key,
  DROP COLUMN IF EXISTS engine_status,
  DROP COLUMN IF EXISTS last_published_at;
