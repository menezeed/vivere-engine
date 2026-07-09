-- ============================================================
-- Migration 0013 — public.activities engine fields
--
-- CONTEXTO (ADR-0015):
-- Primeira migration da engine a alterar public.activities.
-- Adiciona 5 campos de engine sem tocar nos 19 campos existentes.
-- Marca os registos existentes como source_key='legacy'.
--
-- NOTA IMPORTANTE:
-- venue_id NÃO é adicionado — já existe com FK correcta:
--   activities.venue_id → venues.id (constraint atividades_venue_id_fkey)
-- O Publishing Engine reutiliza este campo directamente.
--
-- imagem_url (com typo) é preservado como está. A engine escreve
-- raw_activity_items.image_url → public.activities.imagem_url.
--
-- Campos NUNCA escritos pela engine (ADR-0018):
--   category, schedule, price, is_free, is_sponsored,
--   recurrence_type, recurrence_days, recurrence_time, interested_count
--
-- ROLLBACK: ver 0013_public_activities_engine_fields.rollback.sql
-- ============================================================

-- 1. Adicionar campos da engine
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS engine_activity_id UUID        UNIQUE,
  ADD COLUMN IF NOT EXISTS source_key         TEXT        NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS product_key        TEXT        NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS engine_status      TEXT        NOT NULL DEFAULT 'active'
                              CHECK (engine_status IN ('active', 'archived', 'draft')),
  ADD COLUMN IF NOT EXISTS last_published_at  TIMESTAMPTZ;

-- 2. Comentários
COMMENT ON COLUMN public.activities.engine_activity_id IS
  'UUID do registo em staging.activities_staging que originou esta activity. '
  'NULL para registos legacy. UNIQUE garante idempotência do Publishing Engine.';

COMMENT ON COLUMN public.activities.source_key IS
  'Fonte de origem: prefeitura_cabo_frio, google_places, legacy, etc.';

COMMENT ON COLUMN public.activities.product_key IS
  'Produto ao qual esta activity pertence. ''legacy'' para registos anteriores à engine.';

COMMENT ON COLUMN public.activities.engine_status IS
  'Estado no Operational Model: active, archived, draft. '
  'O app deve filtrar por engine_status = ''active'' para mostrar apenas activities activas.';

COMMENT ON COLUMN public.activities.last_published_at IS
  'Timestamp da última publicação pelo Publishing Engine. '
  'Dirty publishing: updated_at > last_published_at → UPDATE necessário.';

-- 3. Marcar registos existentes como legacy
UPDATE public.activities
  SET source_key           = 'legacy',
      product_key          = 'legacy',
      engine_status        = 'active',
      engine_activity_id   = NULL,
      last_published_at    = COALESCE(created_at, now())
  WHERE engine_activity_id IS NULL;
