/**
 * entity-resolution/pipeline/ThresholdClassifier.ts
 *
 * Implementação do IThresholdClassifier.
 *
 * RESPONSABILIDADE ÚNICA:
 * Recebe ScoredCandidates + ThresholdConfig e produz RankedCandidates
 * com AutoClassification determinística e explicável.
 *
 * DESIGN NOTE — acesso aos VenueCandidates:
 * IThresholdClassifier.classify() recebe ScoredCandidates que contém os
 * CandidateScores mas não os VenueCandidates completos. Para preencher
 * RankedCandidate.candidate, a implementação concreta recebe um mapa
 * de candidatos via construtor ou via método auxiliar enriquecido.
 *
 * A interface contratual é preservada. O enriquecimento é feito pelo
 * HybridScoreCalculator que já tem acesso a FilteredCandidates.
 * O Engine monta o pipeline: HybridScoreCalculator → classifyWithCandidates().
 *
 * LÓGICA DE CLASSIFICAÇÃO:
 *   1 acima de highConfidence  → 'matched'
 *   2+ acima de highConfidence → 'ambiguous'
 *   Nenhum acima, algum ≥ minSuggestion → 'unresolved'
 *   Nenhum ≥ minSuggestion    → 'proposed_new'
 *   Zero candidatos            → 'proposed_new'
 *
 * DESEMPATE: candidatos com score idêntico são ordenados por candidateId
 * lexicográfico — garante resultado determinístico para testes e auditoria.
 */

import type { IThresholdClassifier } from '../interfaces/index.js';
import type {
  ScoredCandidates,
  RankedCandidates,
  RankedCandidate,
  CandidateScore,
  AutoClassification,
  VenueCandidate,
  VenueStagingId,
  FilteredCandidates,
} from '../types/domain.js';
import type { ThresholdConfig } from '../config/index.js';

export class ThresholdClassifier implements IThresholdClassifier {

  /**
   * Implementação do contrato IThresholdClassifier.
   * Produz RankedCandidates com placeholder em candidate.name.
   * Usar classifyWithCandidates() para resultado completo com VenueCandidate real.
   */
  classify(scored: ScoredCandidates, config: ThresholdConfig): RankedCandidates {
    return this.classifyWithCandidates(scored, config, new Map());
  }

  /**
   * Versão enriquecida — recebe o mapa de candidatos do FilteredCandidates.
   * Usado pelo Engine que tem acesso ao FilteredCandidates original.
   *
   * Exemplo de uso no Engine:
   *   const candidateMap = buildCandidateMap(filtered.candidates);
   *   const ranked = classifier.classifyWithCandidates(scored, config, candidateMap);
   */
  classifyWithCandidates(
    scored:       ScoredCandidates,
    config:       ThresholdConfig,
    candidateMap: ReadonlyMap<VenueStagingId, VenueCandidate>,
  ): RankedCandidates {
    const { highConfidence, minSuggestion } = config;

    // Ordenar por finalScore desc, desempate por candidateId asc (determinístico)
    const sorted = [...scored.scores].sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return (a.candidateId as string).localeCompare(b.candidateId as string);
    });

    const classification = this.determineClassification(sorted, highConfidence, minSuggestion);

    const ranked: RankedCandidate[] = sorted.map((score, index) => ({
      candidate:          candidateMap.get(score.candidateId) ?? this.placeholder(score.candidateId),
      score,
      rank:               index + 1,
      autoClassification: classification,
    }));

    return {
      activityId:     scored.activityId,
      venueMention:   scored.venueMention,
      ranked,
      classification,
    };
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  private determineClassification(
    sorted:         readonly CandidateScore[],
    highConfidence: number,
    minSuggestion:  number,
  ): AutoClassification {
    if (sorted.length === 0) return 'proposed_new';

    const aboveHigh = sorted.filter(s => s.finalScore >= highConfidence);
    if (aboveHigh.length === 1) return 'matched';
    if (aboveHigh.length >= 2)  return 'ambiguous';

    const aboveMin = sorted.filter(s => s.finalScore >= minSuggestion);
    if (aboveMin.length > 0) return 'unresolved';

    return 'proposed_new';
  }

  /** Placeholder quando o candidateMap não contém o candidato. */
  private placeholder(candidateId: VenueStagingId): VenueCandidate {
    return {
      id:                   candidateId,
      product_key:          '',
      name:                 `[not-enriched:${candidateId}]`,
      address:              null,
      city:                 null,
      lat:                  null,
      lng:                  null,
      google_types:         [],
      source_category_hint: null,
      proposal_status:      'approved',
    };
  }
}

// ── Utilitário de apoio ───────────────────────────────────────────────────────

/**
 * Constrói o mapa candidateId → VenueCandidate a partir de FilteredCandidates.
 * Usado pelo Engine antes de chamar classifyWithCandidates().
 */
export function buildCandidateMap(
  candidates: readonly VenueCandidate[],
): Map<VenueStagingId, VenueCandidate> {
  return new Map(candidates.map(c => [c.id, c]));
}
