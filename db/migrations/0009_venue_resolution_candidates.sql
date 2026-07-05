-- ============================================================
-- Migration 0009 — staging.venue_resolution_candidates
--
-- CONTEXTO:
-- Regista cada candidato gerado pelo motor para uma actividade.
-- Um candidato é um venue de venues_staging que o algoritmo
-- considerou plausível para uma dada actividade/VenueMention.
--
-- DESIGN KEY — decision_outcome por linha (ADR-0011, Decisão 6):
-- A v1.0 do Architecture Book propunha rejected_candidates UUID[]
-- em venue_resolution_decisions. Substituído por decision_outcome
-- em cada linha de candidato — normalização correcta, indexável,
-- compatível com queries de calibração de threshold.
--
-- product_key incluído por ADR-0011 (Decisão 5).
--
-- Não toca em public.* nem em nenhuma tabela existente.
-- ============================================================

CREATE TABLE IF NOT EXISTS staging.venue_resolution_candidates (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contexto da execução
  run_id                  UUID NOT NULL
                            REFERENCES staging.venue_resolution_runs(id)
                            ON DELETE CASCADE,

  -- Dimensão de produto (ADR-0011 Decisão 5 + ADR-0004)
  product_key             TEXT NOT NULL
                            REFERENCES public.products(product_key),

  -- A actividade que está a ser resolvida
  activity_staging_id     UUID NOT NULL
                            REFERENCES staging.activities_staging(id),

  -- O venue candidato
  candidate_venue_id      UUID NOT NULL
                            REFERENCES staging.venues_staging(id),

  -- ── Scores do algoritmo ──────────────────────────────────
  -- Score final após hybrid + confidence boost (0.000–1.000)
  score                   DECIMAL(5,4) NOT NULL
                            CHECK (score >= 0 AND score <= 1),

  -- Scores parciais por método (auditoria + calibração)
  name_score              DECIMAL(5,4),
  geo_score               DECIMAL(5,4),
  address_score           DECIMAL(5,4),

  -- Método de matching que mais contribuiu (informativo)
  primary_match_method    TEXT CHECK (primary_match_method IN
                            ('exact', 'contains', 'token_overlap', 'trigram',
                             'geo', 'address', 'hybrid')),

  -- Classificação automática do motor para este candidato
  auto_classification     TEXT NOT NULL
                            CHECK (auto_classification IN
                              ('matched', 'ambiguous', 'unresolved', 'proposed_new')),

  -- Detalhe do matching (JSON livre para auditoria e debugging)
  match_detail            JSONB,

  -- ── Decisão humana sobre este candidato (ADR-0011 Decisão 6) ──
  -- Substituí rejected_candidates UUID[] em venue_resolution_decisions.
  -- Cada candidato regista o seu próprio outcome após decisão humana.
  decision_outcome        TEXT CHECK (decision_outcome IN
                            ('accepted', 'rejected', 'skipped')),

  -- FK para a decisão humana que definiu este outcome (nullable até decisão)
  decision_id             UUID,       -- FK adicionada após 0010 criar a tabela de decisions

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE staging.venue_resolution_candidates IS
  'Um candidato gerado pelo Entity Resolution Engine para uma actividade.
   Cada linha representa um venue que o algoritmo considerou plausível.
   decision_outcome regista o resultado da decisão humana sobre este
   candidato específico — substituindo o anti-padrão de arrays UUID.';

COMMENT ON COLUMN staging.venue_resolution_candidates.score IS
  'Score final após HybridScoreCalculator + confidence boost.
   Range: 0.000–1.000. Threshold default para matched: 0.85.
   Calibrar após 100+ decisões humanas registadas.';

COMMENT ON COLUMN staging.venue_resolution_candidates.decision_outcome IS
  'Resultado da decisão humana sobre este candidato específico.
   accepted: o revisor confirmou este venue como o match correcto.
   rejected: o revisor descartou este candidato.
   skipped: revisor não avaliou (ex: outro candidato foi accepted).
   NULL enquanto não há decisão humana.';

COMMENT ON COLUMN staging.venue_resolution_candidates.decision_id IS
  'FK para staging.venue_resolution_decisions.id — adicionada via ALTER
   após a tabela de decisions existir (migration 0010). Permite rastrear
   qual sessão de revisão produziu este outcome.';

-- ── Índices ──────────────────────────────────────────────────────────────────

-- Lookup por actividade (query mais frequente: candidatos de uma actividade)
CREATE INDEX IF NOT EXISTS venue_resolution_candidates_activity_idx
  ON staging.venue_resolution_candidates (activity_staging_id, score DESC);

-- Lookup por run (listar todos os candidatos de uma execução)
CREATE INDEX IF NOT EXISTS venue_resolution_candidates_run_idx
  ON staging.venue_resolution_candidates (run_id);

-- Lookup por produto (observabilidade + calibração por produto)
CREATE INDEX IF NOT EXISTS venue_resolution_candidates_product_idx
  ON staging.venue_resolution_candidates (product_key);

-- Score (calibração: "quantos candidatos com score ≥ 0.85 foram aceitos?")
CREATE INDEX IF NOT EXISTS venue_resolution_candidates_score_idx
  ON staging.venue_resolution_candidates (score DESC)
  WHERE decision_outcome IS NOT NULL;

-- Candidatos sem decisão (fila de revisão pendente)
CREATE INDEX IF NOT EXISTS venue_resolution_candidates_pending_idx
  ON staging.venue_resolution_candidates (activity_staging_id)
  WHERE decision_outcome IS NULL;
