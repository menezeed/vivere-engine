/**
 * entity-resolution/types/domain.ts
 *
 * Tipos de domínio do Entity Resolution Engine da Vivere Platform.
 *
 * PRINCÍPIO: cada tipo representa exactamente um conceito do domínio.
 * Sem DTOs gigantes. Sem arrays soltos entre componentes.
 * Sem acoplamento a Supabase, Hono ou qualquer framework externo.
 *
 * Estes tipos são reutilizáveis para qualquer entidade futura
 * (organizações, eventos, profissionais) — não apenas venues.
 * O sufixo "Venue" aparece apenas onde a especificidade é necessária.
 */

import type { VenueMention } from '../../types/RawActivityItem.js';

// ── Re-export de VenueMention — centralizar a importação ─────────────────────
// VenueMention é definida em RawActivityItem (autoridade epistémica do Collector).
// O ER consome, nunca redefine.
export type { VenueMention };

// ── Tipos de identificação ────────────────────────────────────────────────────

/** UUID de uma actividade em staging.activities_staging. */
export type ActivityStagingId = string & { readonly _brand: 'ActivityStagingId' };

/** UUID de um venue em staging.venues_staging. */
export type VenueStagingId = string & { readonly _brand: 'VenueStagingId' };

/** UUID de uma run do motor em staging.venue_resolution_runs. */
export type ResolutionRunId = string & { readonly _brand: 'ResolutionRunId' };

/** UUID de um candidato em staging.venue_resolution_candidates. */
export type CandidateId = string & { readonly _brand: 'CandidateId' };

/** UUID de uma decisão em staging.venue_resolution_decisions. */
export type DecisionId = string & { readonly _brand: 'DecisionId' };

// ── Venue candidato ───────────────────────────────────────────────────────────

/**
 * Um venue elegível para ser candidato de resolução.
 * Representa uma linha de venues_staging com os campos
 * necessários para o pipeline de matching.
 * Não inclui campos operacionais (reviewed_by, promoted_at, etc.)
 * porque o ER não os utiliza.
 */
export interface VenueCandidate {
  readonly id:                   VenueStagingId;
  readonly product_key:          string;
  readonly name:                 string;
  readonly address:              string | null;
  readonly city:                 string | null;
  readonly lat:                  number | null;
  readonly lng:                  number | null;
  readonly google_types:         readonly string[];
  readonly source_category_hint: string | null;
  readonly proposal_status:      'approved' | 'promoted';
}

// ── Scores ────────────────────────────────────────────────────────────────────

/**
 * Score parcial produzido por um único matcher.
 * Inclui metadados de auditoria — não apenas o número.
 */
export interface MatchScore {
  readonly value:       number;           // 0.000–1.000
  readonly method:      MatchMethod;
  readonly detail:      string;           // frase legível para auditoria
  readonly subMethod?:  string;           // ex: 'exact', 'contains', 'trigram'
}

export type MatchMethod = 'name' | 'geo' | 'address';

/**
 * Score completo de um candidato após todos os matchers.
 * Agrega os scores parciais e o score híbrido final.
 */
export interface CandidateScore {
  readonly candidateId:  VenueStagingId;
  readonly nameScore:    MatchScore | null;
  readonly geoScore:     MatchScore | null;
  readonly addressScore: MatchScore | null;
  readonly hybridScore:  number;             // resultado de HybridScoreCalculator
  readonly finalScore:   number;             // hybridScore + confidence boost
  readonly boostApplied: number;             // valor do boost de confidence_hint
}

// ── Resultados do pipeline ────────────────────────────────────────────────────

/**
 * Classificação automática produzida pelo ThresholdClassifier.
 * Alinhada com venue_resolution_status em activities_staging.
 */
export type AutoClassification =
  | 'matched'        // score ≥ highConfidence e único candidato acima do threshold
  | 'ambiguous'      // score ≥ highConfidence mas múltiplos candidatos acima do threshold
  | 'unresolved'     // score entre minSuggestion e highConfidence — sugestões mas sem confiança
  | 'proposed_new';  // score < minSuggestion ou zero candidatos

/**
 * Um candidato rankeado com score e classificação.
 * Output do ThresholdClassifier para cada candidato.
 */
export interface RankedCandidate {
  readonly candidate:        VenueCandidate;
  readonly score:            CandidateScore;
  readonly rank:             number;         // 1 = melhor score
  readonly autoClassification: AutoClassification;
}

/**
 * Resultado final da resolução de uma actividade.
 * Output do EntityResolutionEngine para cada actividade processada.
 */
export interface ResolutionResult {
  readonly activityId:        ActivityStagingId;
  readonly venueMention:      VenueMention | null;
  readonly classification:    AutoClassification;
  readonly topCandidate:      RankedCandidate | null;   // null se proposed_new sem candidatos
  readonly allCandidates:     readonly RankedCandidate[];
  readonly candidatesInPool:  number;    // antes do PreFilter
  readonly candidatesFiltered: number;  // depois do PreFilter
  readonly processingMs:      number;
  readonly runId:             ResolutionRunId;
}

// ── Objectos de pipeline ─────────────────────────────────────────────────────

/**
 * Pool bruto de candidatos gerado pelo CandidateGenerator.
 * Entrada do CandidatePreFilter.
 */
export interface CandidatePool {
  readonly activityId:    ActivityStagingId;
  readonly venueMention:  VenueMention | null;
  readonly productKey:    string;
  readonly candidates:    readonly VenueCandidate[];
  readonly generatedAt:   number;  // Date.now() — para medir latência
}

/**
 * Pool após filtragem pelo CandidatePreFilter.
 * Entrada dos Matchers.
 */
export interface FilteredCandidates {
  readonly activityId:         ActivityStagingId;
  readonly venueMention:       VenueMention | null;
  readonly candidates:         readonly VenueCandidate[];
  readonly filteredCount:      number;    // quantos foram removidos pelo PreFilter
  readonly originalCount:      number;
  readonly filterReasoning:    string;    // ex: "50 de 160 candidatos após raio 5km"
}

/**
 * Candidatos com scores calculados pelos Matchers.
 * Entrada do HybridScoreCalculator.
 */
export interface ScoredCandidates {
  readonly activityId:   ActivityStagingId;
  readonly venueMention: VenueMention | null;
  readonly scores:       readonly CandidateScore[];
}

/**
 * Candidatos rankeados e classificados.
 * Output do ThresholdClassifier — entrada do orquestrador para persistência.
 */
export interface RankedCandidates {
  readonly activityId:    ActivityStagingId;
  readonly venueMention:  VenueMention | null;
  readonly ranked:        readonly RankedCandidate[];
  readonly classification: AutoClassification;
}

// ── Sumário de execução ───────────────────────────────────────────────────────

/** Sumário de uma run do motor — para observabilidade e auditoria. */
export interface ResolutionRunSummary {
  readonly runId:               ResolutionRunId;
  readonly productKey:          string;
  readonly startedAt:           Date;
  readonly finishedAt:          Date | null;
  readonly status:              'running' | 'success' | 'partial' | 'failed';
  readonly activitiesProcessed: number;
  readonly candidatesGenerated: number;
  readonly classificationCounts: {
    readonly matched:       number;
    readonly ambiguous:     number;
    readonly unresolved:    number;
    readonly proposed_new:  number;
  };
  readonly errorCount:          number;
  readonly triggeredBy:         string;  // 'manual' | 'scheduler' | 'post_ingestion'
}

// ── Decisão humana ────────────────────────────────────────────────────────────

/** Acção tomada pelo revisor humano. */
export type DecisionAction = 'matched' | 'proposed_new' | 'skipped';

/** Outcome de um candidato individual após decisão humana. */
export type CandidateOutcome = 'accepted' | 'rejected' | 'skipped';

/** Representa a decisão humana registada pelo Admin Panel. */
export interface ResolutionDecision {
  readonly id:                    DecisionId;
  readonly productKey:            string;
  readonly activityId:            ActivityStagingId;
  readonly action:                DecisionAction;
  readonly acceptedCandidateId:   CandidateId | null;
  readonly userId:                string;
  readonly reviewedAt:            Date;
  readonly notes:                 string | null;
  readonly overrodeHighConfidence: boolean;
}
