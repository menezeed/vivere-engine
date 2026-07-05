-- ============================================================
-- Migration 0010 — staging.venue_resolution_decisions
--
-- CONTEXTO:
-- Regista a decisão humana sobre a resolução de uma actividade.
-- Uma decisão cobre o conjunto de candidatos de uma actividade:
-- o revisor escolhe o candidato aceite, e os restantes ficam
-- marcados como rejected/skipped na tabela de candidatos.
--
-- Não usa arrays UUID (ADR-0011, Decisão 6). Os candidatos
-- rejeitados são consultados via JOIN em venue_resolution_candidates
-- WHERE activity_staging_id = X AND decision_outcome = 'rejected'.
--
-- product_key incluído por ADR-0011 (Decisão 5) e ADR-0004.
--
-- A FK de venue_resolution_candidates.decision_id é adicionada
-- nesta migration via ALTER TABLE, após a tabela de decisions existir.
--
-- Não toca em public.* nem em nenhuma tabela existente.
-- ============================================================

CREATE TABLE IF NOT EXISTS staging.venue_resolution_decisions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dimensão de produto (ADR-0011 Decisão 5 + ADR-0004)
  product_key             TEXT NOT NULL
                            REFERENCES public.products(product_key),

  -- A actividade cuja resolução foi decidida
  activity_staging_id     UUID NOT NULL
                            REFERENCES staging.activities_staging(id),

  -- Acção tomada pelo revisor
  action                  TEXT NOT NULL
                            CHECK (action IN ('matched', 'proposed_new', 'skipped')),

  -- O candidato aceite (NULL se action = 'proposed_new' ou 'skipped')
  accepted_candidate_id   UUID
                            REFERENCES staging.venue_resolution_candidates(id),

  -- Quem decidiu e quando
  user_id                 TEXT NOT NULL,    -- UUID do utilizador Supabase Auth
  reviewed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Notas opcionais do revisor (justificação de override, contexto)
  notes                   TEXT,

  -- Se o revisor sobrepôs uma classificação automática de alta confiança
  overrode_high_confidence BOOLEAN NOT NULL DEFAULT false,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE staging.venue_resolution_decisions IS
  'A decisão humana sobre a resolução de venue de uma actividade.
   Uma decisão por sessão de revisão. Os candidatos rejeitados são
   consultados via JOIN em venue_resolution_candidates com decision_outcome
   = rejected — sem arrays UUID (ADR-0011 Decisão 6).';

COMMENT ON COLUMN staging.venue_resolution_decisions.action IS
  'matched: revisor confirmou um venue existente como o match correcto.
   proposed_new: revisor confirmou que nenhum venue existente corresponde.
   skipped: revisor não tinha informação suficiente para decidir.';

COMMENT ON COLUMN staging.venue_resolution_decisions.overrode_high_confidence IS
  'TRUE quando o revisor escolheu um candidato diferente do que o motor
   classificou como matched (high confidence). Útil para calibração —
   alta taxa de override sugere que os thresholds ou pesos precisam de ajuste.';

-- ── FK retroactiva em venue_resolution_candidates ────────────────────────────
-- Adiciona a FK que estava pendente na migration 0009 (a tabela de
-- decisions não existia ainda naquele momento).

ALTER TABLE staging.venue_resolution_candidates
  ADD CONSTRAINT fk_candidate_decision
  FOREIGN KEY (decision_id)
  REFERENCES staging.venue_resolution_decisions(id)
  ON DELETE SET NULL;

-- ── Índices ──────────────────────────────────────────────────────────────────

-- Lookup por actividade (query mais frequente: decisão de uma actividade)
CREATE INDEX IF NOT EXISTS venue_resolution_decisions_activity_idx
  ON staging.venue_resolution_decisions (activity_staging_id, reviewed_at DESC);

-- Lookup por produto (observabilidade por produto)
CREATE INDEX IF NOT EXISTS venue_resolution_decisions_product_idx
  ON staging.venue_resolution_decisions (product_key, reviewed_at DESC);

-- Lookup por utilizador (quem fez o quê — auditoria)
CREATE INDEX IF NOT EXISTS venue_resolution_decisions_user_idx
  ON staging.venue_resolution_decisions (user_id, reviewed_at DESC);

-- Overrides de alta confiança (calibração de thresholds)
CREATE INDEX IF NOT EXISTS venue_resolution_decisions_overrides_idx
  ON staging.venue_resolution_decisions (product_key, reviewed_at DESC)
  WHERE overrode_high_confidence = true;
