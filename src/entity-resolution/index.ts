/**
 * src/entity-resolution/index.ts
 *
 * Ponto único de entrada do Entity Resolution Kernel.
 *
 * Qualquer código externo ao módulo importa APENAS daqui.
 * O que não está exportado aqui é detalhe de implementação interno.
 *
 * Uso:
 *   import { IMatcher, DEFAULT_ER_CONFIG, ERResult } from '../entity-resolution/index.js';
 */

// ── Tipos de domínio ──────────────────────────────────────────────────────────
export type {
  VenueMention,
  ActivityStagingId,
  VenueStagingId,
  ResolutionRunId,
  CandidateId,
  DecisionId,
  VenueCandidate,
  MatchScore,
  MatchMethod,
  CandidateScore,
  AutoClassification,
  RankedCandidate,
  ResolutionResult,
  CandidatePool,
  FilteredCandidates,
  ScoredCandidates,
  RankedCandidates,
  ResolutionRunSummary,
  DecisionAction,
  CandidateOutcome,
  ResolutionDecision,
} from './types/domain.js';

// ── Result Pattern ────────────────────────────────────────────────────────────
export type {
  ERResult,
  BatchERResult,
  SuccessResult,
  PartialSuccessResult,
  UnresolvedResult,
  FailedResult,
  UnresolvedReason,
} from './types/result.js';

export {
  success,
  partial,
  unresolved,
  failed,
  isSuccess,
  isPartial,
  isUnresolved,
  isFailed,
  hasResult,
} from './types/result.js';

// ── Configuração ──────────────────────────────────────────────────────────────
export type {
  CandidateSelectionConfig,
  ScoringConfig,
  ScoringWeights,
  ConfidenceBoost,
  ThresholdConfig,
  EntityResolutionConfig,
} from './config/index.js';

export {
  DEFAULT_CANDIDATE_SELECTION,
  DEFAULT_SCORING,
  DEFAULT_THRESHOLDS,
  DEFAULT_ER_CONFIG,
  validateERConfig,
} from './config/index.js';

// ── Interfaces dos componentes ────────────────────────────────────────────────
export type {
  IMatcher,
  INameMatcher,
  IGeoMatcher,
  IAddressMatcher,
  IHybridScoreCalculator,
  IThresholdClassifier,
  ICandidateGenerator,
  ICandidatePreFilter,
  IEntityResolutionEngine,
  IResolutionReviewer,
} from './interfaces/index.js';

// ── Providers (ajuste #3 — CandidateGenerator genérico) ──────────────────────
export type {
  ICandidateProvider,
  IVenueCandidateProvider,
} from './interfaces/providers.js';

// ── Interfaces dos repositórios ───────────────────────────────────────────────
export type {
  IVenueResolutionRunRepository,
  IVenueResolutionCandidateRepository,
  IVenueResolutionDecisionRepository,
  IEntityResolutionRepositorySet,
} from './repositories/interfaces.js';

export { EntityResolutionRepositoryFactory } from './repositories/factory.js';

// ── Pipeline contracts ────────────────────────────────────────────────────────
export {
  assertFilteredCandidates,
  assertScoredCandidates,
  assertScoreRange,
  classificationLabel,
  requiresReview,
  wasProcessed,
} from './pipeline/contracts.js';

// ── Logging e métricas (ajustes #2, #3, #4, #5) ──────────────────────────────
export { ERLogger, ERSilentLogger, startTimer } from './utils/logging.js';
export type {
  IERLogger,
  PipelineMetrics,
  OperationalMetrics,
  BusinessMetrics,
  RunSummaryLog,
} from './utils/logging.js';

// ── Erros ─────────────────────────────────────────────────────────────────────
export {
  ERError,
  CandidateGenerationError,
  NoCandidateFoundError,
  MatcherConfigurationError,
  ConfigurationError,
  InvalidResolutionStateError,
  RunAlreadyActiveError,
  DecisionConflictError,
  RepositoryError,
  ActivityNotFoundError,
  VenueNotFoundError,
  isERError,
} from './errors/index.js';

export type { ERErrorCode } from './errors/index.js';
