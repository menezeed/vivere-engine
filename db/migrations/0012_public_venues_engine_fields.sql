-- ============================================================
-- Migration 0012 — public.venues engine fields
--
-- CONTEXTO (ADR-0015):
-- Primeira migration da engine a alterar public.venues.
-- Adiciona 5 campos de engine sem tocar nos 11 campos existentes.
-- Marca os registos existentes como source_key='legacy'.
--
-- PRÉ-REQUISITOS:
-- 1. Backup manual de public.venues efectuado
-- 2. Schema Discovery (Sprint 8.0) concluído
-- 3. Ausência de conflitos de nomes confirmada
--
-- SEGURANÇA:
-- Todos os ADD COLUMN usam IF NOT EXISTS — idempotente.
-- O UPDATE usa WHERE engine_venue_id IS NULL — nunca sobrescreve
-- registos já publicados pela engine.
-- Nenhum dado existente é apagado ou alterado nos campos originais.
--
-- ROLLBACK: ver 0012_public_venues_engine_fields.rollback.sql
-- ============================================================

-- 1. Adicionar campos da engine
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS engine_venue_id   UUID        UNIQUE,
  ADD COLUMN IF NOT EXISTS source_key        TEXT        NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS product_key       TEXT        NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS engine_status     TEXT        NOT NULL DEFAULT 'active'
                             CHECK (engine_status IN ('active', 'archived', 'draft')),
  ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMPTZ;

-- 2. Comentários para documentação no banco
COMMENT ON COLUMN public.venues.engine_venue_id IS
  'UUID do registo em staging.venues_staging que originou este venue. '
  'NULL para registos legacy (anteriores à Vivere Engine). UNIQUE garante idempotência.';

COMMENT ON COLUMN public.venues.source_key IS
  'Fonte de origem: google_places, prefeitura_cabo_frio, legacy. '
  'O Publishing Engine filtra source_key != ''legacy'' nas suas operações.';

COMMENT ON COLUMN public.venues.product_key IS
  'Produto ao qual este venue pertence. '
  '''legacy'' para registos anteriores à Vivere Engine.';

COMMENT ON COLUMN public.venues.engine_status IS
  'Estado no Operational Model: active (visível), archived (oculto), draft (interno). '
  'Distinto de qualquer campo status do app — usa prefixo engine_ para evitar colisão.';

COMMENT ON COLUMN public.venues.last_published_at IS
  'Timestamp da última vez que o Publishing Engine escreveu neste registo. '
  'Usado pelo dirty publishing: updated_at > last_published_at → UPDATE necessário.';

-- 3. Marcar registos existentes como legacy
-- WHERE engine_venue_id IS NULL garante idempotência:
-- se a migration for re-executada, não sobrescreve venues da engine
UPDATE public.venues
  SET source_key        = 'legacy',
      product_key       = 'legacy',
      engine_status     = 'active',
      engine_venue_id   = NULL,
      last_published_at = COALESCE(created_at, now())
  WHERE engine_venue_id IS NULL;
