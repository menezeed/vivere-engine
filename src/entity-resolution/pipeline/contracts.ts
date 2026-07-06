/**
 * entity-resolution/pipeline/contracts.ts
 *
 * Contratos dos objectos que passam entre as etapas do pipeline.
 *
 * O pipeline do ER é uma cadeia de transformações tipadas:
 *
 *   VenueMention           (input — de RawActivityItem)
 *        ↓
 *   CandidatePool          (output de ICandidateGenerator)
 *        ↓
 *   FilteredCandidates     (output de ICandidatePreFilter)
 *        ↓
 *   ScoredCandidates       (output de IHybridScoreCalculator)
 *        ↓
 *   RankedCandidates       (output de IThresholdClassifier)
 *        ↓
 *   ResolutionResult       (output final do IEntityResolutionEngine)
 *
 * Nenhuma etapa recebe arrays soltos.
 * Cada etapa sabe exactamente o que recebe e o que produz.
 *
 * Os tipos de domínio (CandidatePool, FilteredCandidates, etc.)
 * estão em types/domain.ts — este ficheiro documenta as invariantes
 * de cada transição e expõe funções de utilidade de pipeline.
 */

import type {
  CandidatePool,
  FilteredCandidates,
  ScoredCandidates,
  RankedCandidates,
  ResolutionResult,
  AutoClassification,
} from '../types/domain.js';

// ── Re-exports para consumo unificado ────────────────────────────────────────
// Os componentes do pipeline importam de contracts.ts — ponto único de entrada.
export type {
  CandidatePool,
  FilteredCandidates,
  ScoredCandidates,
  RankedCandidates,
  ResolutionResult,
};

// ── Invariantes do pipeline (documentadas como funções de validação) ──────────

/**
 * Invariante: FilteredCandidates deve ter no máximo maxCandidates elementos.
 * Verifica em runtime durante desenvolvimento — pode ser removida em produção.
 */
export function assertFilteredCandidates(
  filtered: FilteredCandidates,
  maxCandidates: number,
): void {
  if (filtered.candidates.length > maxCandidates) {
    throw new Error(
      `Invariante violada: FilteredCandidates tem ${filtered.candidates.length} candidatos ` +
      `mas maxCandidates é ${maxCandidates}. O CandidatePreFilter não está a aplicar o limite.`,
    );
  }
  if (filtered.candidates.length > filtered.originalCount) {
    throw new Error(
      `Invariante violada: filteredCount (${filtered.candidates.length}) > ` +
      `originalCount (${filtered.originalCount}). O PreFilter não pode adicionar candidatos.`,
    );
  }
}

/**
 * Invariante: ScoredCandidates deve ter exactamente os mesmos candidatos
 * que FilteredCandidates (um score por candidato, nenhum adicionado ou removido).
 */
export function assertScoredCandidates(
  filtered: FilteredCandidates,
  scored: ScoredCandidates,
): void {
  if (scored.scores.length !== filtered.candidates.length) {
    throw new Error(
      `Invariante violada: ScoredCandidates tem ${scored.scores.length} scores ` +
      `mas FilteredCandidates tem ${filtered.candidates.length} candidatos. ` +
      `O HybridScoreCalculator deve produzir exactamente um score por candidato.`,
    );
  }
}

/**
 * Invariante: todos os scores finais devem estar em [0, 1].
 */
export function assertScoreRange(scored: ScoredCandidates): void {
  for (const s of scored.scores) {
    if (s.finalScore < 0 || s.finalScore > 1.001) {
      throw new Error(
        `Invariante violada: score final ${s.finalScore.toFixed(4)} fora do range [0, 1] ` +
        `para candidato ${s.candidateId}. Verificar HybridScoreCalculator e confidence boost.`,
      );
    }
  }
}

// ── Utilitários de pipeline ───────────────────────────────────────────────────

/** Retorna a classificação automática dominante de um resultado. */
export function classificationLabel(c: AutoClassification): string {
  const labels: Record<AutoClassification, string> = {
    matched:       'Venue identificado com alta confiança',
    ambiguous:     'Múltiplos candidatos plausíveis — revisão necessária',
    unresolved:    'Venue não identificado — sugestões disponíveis',
    proposed_new:  'Venue possivelmente novo — não existe em staging',
  };
  return labels[c];
}

/** Retorna true se o resultado requer atenção imediata do revisor. */
export function requiresReview(classification: AutoClassification): boolean {
  return classification === 'matched' || classification === 'ambiguous';
}

/** Retorna true se o resultado foi processado com sucesso (mesmo que unresolved). */
export function wasProcessed(result: ResolutionResult): boolean {
  return result.allCandidates.length >= 0; // sempre true — sem candidatos é proposed_new
}
