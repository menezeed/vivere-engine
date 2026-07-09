-- ============================================================
-- Rollback 0013 — remover engine fields de public.activities
-- ============================================================

ALTER TABLE public.activities
  DROP COLUMN IF EXISTS engine_activity_id,
  DROP COLUMN IF EXISTS source_key,
  DROP COLUMN IF EXISTS product_key,
  DROP COLUMN IF EXISTS engine_status,
  DROP COLUMN IF EXISTS last_published_at;
