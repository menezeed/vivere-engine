/**
 * entity-resolution/pipeline/HybridScoreCalculator.ts
 *
 * Implementação do IHybridScoreCalculator.
 *
 * RESPONSABILIDADE ÚNICA:
 * Recebe FilteredCandidates + lista de IMatcher + ScoringConfig,
 * executa cada matcher sobre cada candidato, agrega os scores
 * parciais com pesos, aplica confidence boost, e produz ScoredCandidates.
 *
 * O QUE ESTE COMPONENTE NÃO FAZ:
 * — Não classifica (responsabilidade do ThresholdClassifier)
 * — Não persiste (responsabilidade dos repositórios)
 * — Não filtra candidatos (responsabilidade do CandidatePreFilter)
 * — Não conhece thresholds
 *
 * FÓRMULA:
 *   hybridScore = (name × w.name) + (geo × w.geo) + (address × w.address)
 *   finalScore  = clip(hybridScore + confidenceBoost[hint], 0, 1)
 *
 * Matchers ausentes (retornam null) são ignorados na ponderação:
 *   — Os pesos dos matchers activos são renormalizados
 *   — Ex: sem GeoMatcher, name passa de 0.50 para 0.77 (0.50/(0.50+0.15))
 *   — Garante que o score final usa a escala completa [0, 1]
 */

import type { IHybridScoreCalculator, IMatcher } from '../interfaces/index.js';
import type {
  FilteredCandidates,
  ScoredCandidates,
  CandidateScore,
  MatchScore,
  VenueCandidate,
} from '../types/domain.js';
import type { VenueMention } from '../../types/RawActivityItem.js';
import type { ScoringConfig } from '../config/index.js';
import { assertScoredCandidates, assertScoreRange } from './contracts.js';

export class HybridScoreCalculator implements IHybridScoreCalculator {

  /**
   * Calcula o score híbrido para cada candidato filtrado.
   *
   * Cada matcher é executado para cada candidato.
   * Matchers que retornam null são excluídos da ponderação.
   * O score final é clippado em [0, 1].
   */
  calculate(
    candidates: FilteredCandidates,
    matchers:   readonly IMatcher[],
    config:     ScoringConfig,
  ): ScoredCandidates {
    const mention = candidates.venueMention;

    const scores: CandidateScore[] = candidates.candidates.map(candidate =>
      this.scoreCandidate(candidate, mention, matchers, config),
    );

    const result: ScoredCandidates = {
      activityId:   candidates.activityId,
      venueMention: mention,
      scores,
    };

    // Invariantes do pipeline (falham em dev, removíveis em prod)
    assertScoredCandidates(candidates, result);
    assertScoreRange(result);

    return result;
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  private scoreCandidate(
    candidate: VenueCandidate,
    mention:   VenueMention | null,
    matchers:  readonly IMatcher[],
    config:    ScoringConfig,
  ): CandidateScore {
    // Executar cada matcher
    const nameScore    = mention ? this.runMatcher(matchers, 'name',    mention, candidate) : null;
    const geoScore     = mention ? this.runMatcher(matchers, 'geo',     mention, candidate) : null;
    const addressScore = mention ? this.runMatcher(matchers, 'address', mention, candidate) : null;

    // Calcular score híbrido com pesos renormalizados
    const hybridScore = this.calculateHybrid(nameScore, geoScore, addressScore, config);

    // Aplicar confidence boost
    const boost      = this.resolveBoost(mention, config);
    const finalScore = Math.max(0, Math.min(1, hybridScore + boost));

    return {
      candidateId:  candidate.id,
      nameScore,
      geoScore,
      addressScore,
      hybridScore,
      finalScore,
      boostApplied: boost,
    };
  }

  private runMatcher(
    matchers:  readonly IMatcher[],
    id:        string,
    mention:   VenueMention,
    candidate: VenueCandidate,
  ): MatchScore | null {
    const matcher = matchers.find(m => m.id === id);
    if (!matcher) return null;
    try {
      return matcher.score(mention, candidate);
    } catch {
      return null;
    }
  }

  private calculateHybrid(
    name:    MatchScore | null,
    geo:     MatchScore | null,
    address: MatchScore | null,
    config:  ScoringConfig,
  ): number {
    const w = config.weights;

    // Construir pares (score, peso) apenas para matchers activos
    const active: Array<{ score: number; weight: number }> = [];
    if (name    !== null) active.push({ score: name.value,    weight: w.name    });
    if (geo     !== null) active.push({ score: geo.value,     weight: w.geo     });
    if (address !== null) active.push({ score: address.value, weight: w.address });

    // Sem nenhum score activo → 0
    if (active.length === 0) return 0;

    const totalWeight = active.reduce((sum, a) => sum + a.weight, 0);

    // Renormalizar pesos (evita deflação quando matchers retornam null)
    const weighted = active.reduce(
      (sum, a) => sum + a.score * (a.weight / totalWeight),
      0,
    );

    return Math.max(0, Math.min(1, weighted));
  }

  private resolveBoost(mention: VenueMention | null, config: ScoringConfig): number {
    if (!mention) return 0;
    return config.confidenceBoost[mention.confidence_hint] ?? 0;
  }
}
