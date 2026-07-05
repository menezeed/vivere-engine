-- ============================================================
-- Migration 0008 — staging.venue_resolution_runs
--
-- CONTEXTO:
-- Regista cada execução do Entity Resolution Engine.
-- Análogo a staging.ingestion_runs para o pipeline de ingestão —
-- mesmo padrão de ciclo de vida: nasce como 'running', fecha
-- como 'success'/'partial'/'failed', nunca alterado após fecho.
--
-- product_key incluído por exigência do ADR-0011 (Decisão 5) e
-- ADR-0004 (multi-produto): queries de observabilidade filtram
-- por produto sem JOIN.
--
-- Não toca em public.* nem em nenhuma tabela existente.
-- ============================================================

CREATE TABLE IF NOT EXISTS staging.venue_resolution_runs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dimensão de produto — obrigatória (ADR-0004, ADR-0011)
  product_key             TEXT NOT NULL
                            REFERENCES public.products(product_key),

  -- Ciclo de vida da execução
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at             TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'success', 'partial', 'failed')),

  -- Estatísticas da execução
  activities_processed    INTEGER NOT NULL DEFAULT 0,
  candidates_generated    INTEGER NOT NULL DEFAULT 0,

  -- Contexto de execução
  triggered_by            TEXT,       -- 'manual', 'scheduler', 'post_ingestion'
  notes                   TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE staging.venue_resolution_runs IS
  'Uma execução do Entity Resolution Engine. Nasce como running, fecha
   como success/partial/failed. Nunca alterado após finished_at preenchido.
   Análogo a staging.ingestion_runs para o pipeline de ingestão.';

COMMENT ON COLUMN staging.venue_resolution_runs.product_key IS
  'Produto para o qual esta execução resolveu venues. Obrigatório — o motor
   é agnóstico de produto mas cada run pertence a um produto específico.';

COMMENT ON COLUMN staging.venue_resolution_runs.triggered_by IS
  'Origem da execução: manual (via Admin Panel), scheduler (automático),
   post_ingestion (após uma ingestão completar). Útil para diagnóstico.';

-- ── Índices ──────────────────────────────────────────────────────────────────

-- Filtro por produto + tempo (queries de observabilidade mais comuns)
CREATE INDEX IF NOT EXISTS venue_resolution_runs_product_started_idx
  ON staging.venue_resolution_runs (product_key, started_at DESC);

-- Filtro por status (encontrar runs em andamento rapidamente)
CREATE INDEX IF NOT EXISTS venue_resolution_runs_status_idx
  ON staging.venue_resolution_runs (status)
  WHERE status = 'running';
