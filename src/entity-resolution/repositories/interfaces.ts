/**
 * entity-resolution/repositories/interfaces.ts
 *
 * Interfaces dos repositórios do Entity Resolution Engine.
 *
 * Segue exactamente o padrão estabelecido em
 * src/persistence/types/repositoryInterfaces.ts:
 * — Interfaces puras, sem dependência de Supabase
 * — IEntityResolutionRepositorySet agrupa os três
 * — EntityResolutionRepositoryFactory monta o set (análogo a RepositoryFactory)
 *
 * Nenhuma implementação concreta aqui — apenas contratos.
 * As implementações concretas ficam em repositories/*.ts (Sprint 7.4).
 */

import type {
  ResolutionRunId,
  ActivityStagingId,
  VenueStagingId,
  CandidateId,
  DecisionId,
  RankedCandidate,
  ResolutionRunSummary,
  ResolutionDecision,
  DecisionAction,
} from '../types/domain.js';

// ── IVenueResolutionRunRepository ────────────────────────────────────────────

/**
 * Ciclo de vida de uma run de resolução.
 * Mesmo padrão de IIngestionRunRepository: start/finish/markFailed.
 */
export interface IVenueResolutionRunRepository {
  /** Inicia uma nova run e retorna o seu ID. */
  start(productKey: string, triggeredBy: string): Promise<ResolutionRunId>;

  /** Fecha uma run com sucesso, actualizando estatísticas. */
  finish(
    runId: ResolutionRunId,
    stats: {
      activitiesProcessed: number;
      candidatesGenerated: number;
    },
  ): Promise<void>;

  /** Marca uma run como failed com o motivo. */
  markFailed(runId: ResolutionRunId, reason: string): Promise<void>;

  /** Retorna a run activa para um produto (null se não existir). */
  findActive(productKey: string): Promise<ResolutionRunSummary | null>;
}

// ── IVenueResolutionCandidateRepository ──────────────────────────────────────

export interface IVenueResolutionCandidateRepository {
  /**
   * Apaga todos os candidatos de uma actividade sem decisão humana.
   * Chamado pelo motor antes de re-resolver (ADR-0013 — política de idempotência).
   * Retorna o número de candidatos apagados (0 se não existiam).
   * NUNCA apaga candidatos com decision_outcome definido.
   */
  deleteByActivity(activityId: ActivityStagingId): Promise<number>;

  /**
   * Persiste os candidatos rankeados de uma actividade.
   * Retorna os IDs dos candidatos inseridos.
   */
  insertCandidates(
    runId:      ResolutionRunId,
    activityId: ActivityStagingId,
    productKey: string,
    candidates: readonly RankedCandidate[],
  ): Promise<CandidateId[]>;

  /** Retorna os candidatos de uma actividade, ordenados por score desc. */
  findByActivity(
    activityId: ActivityStagingId,
  ): Promise<ReadonlyArray<{
    id:                 CandidateId;
    candidateVenueId:   VenueStagingId;
    score:              number;
    nameScore:          number | null;
    geoScore:           number | null;
    addressScore:       number | null;
    autoClassification: string;
    decisionOutcome:    string | null;
  }>>;

  /**
   * Regista o outcome de um candidato após decisão humana.
   * Chamado quando o revisor aceita, rejeita ou salta um candidato.
   */
  setOutcome(
    candidateId: CandidateId,
    outcome:     'accepted' | 'rejected' | 'skipped',
    decisionId:  DecisionId,
  ): Promise<void>;

  /**
   * Retorna o pool de candidatos elegíveis para matching.
   * Consulta venues_staging WHERE proposal_status IN (approved, promoted).
   * Este método é usado pelo CandidateGenerator — não pelo revisor.
   */
  findEligibleVenues(
    productKey:     string,
    allowedStatuses: readonly ('approved' | 'promoted')[],
  ): Promise<ReadonlyArray<{
    id:                   VenueStagingId;
    name:                 string;
    address:              string | null;
    city:                 string | null;
    lat:                  number | null;
    lng:                  number | null;
    google_types:         string[];
    source_category_hint: string | null;
    proposal_status:      'approved' | 'promoted';
  }>>;
}

// ── IVenueResolutionDecisionRepository ───────────────────────────────────────

export interface IVenueResolutionDecisionRepository {
  /** Regista a decisão humana sobre uma actividade. */
  record(
    productKey:            string,
    activityId:            ActivityStagingId,
    action:                DecisionAction,
    acceptedCandidateId:   CandidateId | null,
    userId:                string,
    notes:                 string | null,
    overrodeHighConfidence: boolean,
  ): Promise<DecisionId>;

  /** Retorna a decisão mais recente para uma actividade (null se não existir). */
  findLatest(activityId: ActivityStagingId): Promise<ResolutionDecision | null>;

  /**
   * Retorna actividades que ainda não têm decisão e já têm candidatos gerados.
   * Usada pelo Admin Panel para montar a fila de revisão.
   */
  findPendingReview(
    productKey: string,
    limit?:     number,
  ): Promise<ReadonlyArray<ActivityStagingId>>;
}

// ── IEntityResolutionRepositorySet ───────────────────────────────────────────

/**
 * O conjunto completo de repositórios ER.
 * Análogo a IRepositorySet da engine de ingestão.
 * O EntityResolutionEngine recebe este set — nunca as implementações concretas.
 */
export interface IEntityResolutionRepositorySet {
  run:       IVenueResolutionRunRepository;
  candidate: IVenueResolutionCandidateRepository;
  decision:  IVenueResolutionDecisionRepository;
}
