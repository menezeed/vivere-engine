-- ============================================================
-- Migration 0014 — public.publication_runs
--
-- Tabela de auditoria de runs do Publishing Engine.
-- Análoga a staging.ingestion_runs e staging.venue_resolution_runs.
-- Fica em public.* porque é dado operacional (não curadoria).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.publication_runs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key           TEXT        NOT NULL,
  triggered_by          TEXT        NOT NULL,  -- 'manual', 'scheduler', 'post-ingestion'
  engine_version        TEXT,
  git_tag               TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at           TIMESTAMPTZ,
  status                TEXT        NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'success', 'partial', 'failed')),
  -- Métricas de venues
  venues_published      INTEGER     NOT NULL DEFAULT 0,
  venues_updated        INTEGER     NOT NULL DEFAULT 0,
  venues_skipped        INTEGER     NOT NULL DEFAULT 0,
  venues_archived       INTEGER     NOT NULL DEFAULT 0,
  -- Métricas de activities
  activities_published  INTEGER     NOT NULL DEFAULT 0,
  activities_updated    INTEGER     NOT NULL DEFAULT 0,
  activities_skipped    INTEGER     NOT NULL DEFAULT 0,
  activities_archived   INTEGER     NOT NULL DEFAULT 0,
  -- Sumário
  errors                INTEGER     NOT NULL DEFAULT 0,
  duration_ms           INTEGER,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.publication_runs IS
  'Auditoria de runs do Publishing Engine. '
  'Uma linha por execução de publishAll() ou publish de produto específico.';

CREATE INDEX IF NOT EXISTS publication_runs_product_started_idx
  ON public.publication_runs (product_key, started_at DESC);

CREATE INDEX IF NOT EXISTS publication_runs_status_idx
  ON public.publication_runs (status)
  WHERE status = 'running';
