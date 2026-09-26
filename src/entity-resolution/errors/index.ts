/**
 * entity-resolution/errors/index.ts
 *
 * Erros específicos do Entity Resolution Engine.
 *
 * Princípio: nenhuma função do ER lança Error genérico.
 * Cada erro tem um código único, mensagem estruturada e contexto.
 * O chamador pode inspeccionar o código sem fazer string matching.
 *
 * ERError é a superclasse — todos os erros do ER são instanceof ERError.
 * Isso permite catch genérico quando necessário, mas com acesso ao código.
 */

// ── Base ──────────────────────────────────────────────────────────────

export type ERErrorCode =
  | 'CANDIDATE_GENERATION_ERROR'
  | 'MATCHER_CONFIGURATION_ERROR'
  | 'INVALID_RESOLUTION_STATE'
  | 'NO_CANDIDATE_FOUND'
  | 'REPOSITORY_ERROR'
  | 'RUN_ALREADY_ACTIVE'
  | 'ACTIVITY_NOT_FOUND'
  | 'VENUE_NOT_FOUND'
  | 'INVALID_CANDIDATE_OUTCOME'
  | 'DECISION_CONFLICT'
  | 'CONFIGURATION_ERROR'
  | 'CANDIDATE_NOT_IN_POOL';

export abstract class ERError extends Error {
  abstract readonly code: ERErrorCode;
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
  }
}

// ── Erros de geração de candidatos ──────────────────────────────────────

/**
 * Falha ao consultar o pool de candidatos no banco.
 * Tipicamente: erro de conexão ou query inválida.
 */
export class CandidateGenerationError extends ERError {
  readonly code = 'CANDIDATE_GENERATION_ERROR' as const;

  constructor(activityId: string, cause: unknown) {
    super(
      `Falha ao gerar candidatos para actividade ${activityId}`,
      { activityId, cause: String(cause) },
    );
  }
}

/**
 * O pool de candidatos existe mas nenhum passou pelo PreFilter.
 * Não é necessariamente um erro — pode ser estado legítimo (venue novo).
 * Mas é diferente de pool vazio.
 */
export class NoCandidateFoundError extends ERError {
  readonly code = 'NO_CANDIDATE_FOUND' as const;

  constructor(activityId: string, poolSize: number, filterReason: string) {
    super(
      `Nenhum candidato encontrado após filtragem para actividade ${activityId}`,
      { activityId, poolSize, filterReason },
    );
  }
}

/**
 * Level 2, 2026-09-26 — Human Resolution. Um candidateVenueId fornecido
 * pelo revisor não corresponde a nenhum candidato do pool gerado para
 * esta actividade (VenueResolutionCandidateRepository.findByActivity()).
 * Distinto de VenueNotFoundError (venue não existe globalmente) — aqui o
 * venue pode existir perfeitamente, só nunca foi candidato desta
 * actividade específica.
 */
export class CandidateNotInPoolError extends ERError {
  readonly code = 'CANDIDATE_NOT_IN_POOL' as const;

  constructor(activityId: string, candidateVenueId: string) {
    super(
      `Venue ${candidateVenueId} não pertence ao pool de candidatos da actividade ${activityId}`,
      { activityId, candidateVenueId },
    );
  }
}

// ── Erros de configuração ──────────────────────────────────────────────

/**
 * Configuração inválida de um matcher ou da engine.
 * Ex: pesos que não somam 1.0, threshold fora de [0,1].
 */
export class MatcherConfigurationError extends ERError {
  readonly code = 'MATCHER_CONFIGURATION_ERROR' as const;

  constructor(component: string, field: string, value: unknown, reason: string) {
    super(
      `Configuração inválida em ${component}: ${field}=${String(value)} — ${reason}`,
      { component, field, value, reason },
    );
  }
}

export class ConfigurationError extends ERError {
  readonly code = 'CONFIGURATION_ERROR' as const;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context);
  }
}

// ── Erros de estado ──────────────────────────────────────────────────

/**
 * Tentativa de transição inválida de venue_resolution_status.
 * Ex: tentar resolver uma actividade já com status matched.
 */
export class InvalidResolutionStateError extends ERError {
  readonly code = 'INVALID_RESOLUTION_STATE' as const;

  constructor(activityId: string, currentStatus: string, attemptedAction: string) {
    super(
      `Transição inválida para actividade ${activityId}: status=${currentStatus}, acção=${attemptedAction}`,
      { activityId, currentStatus, attemptedAction },
    );
  }
}

/**
 * Já existe uma run activa para o mesmo produto.
 * O motor não deve ter runs concorrentes por produto.
 */
export class RunAlreadyActiveError extends ERError {
  readonly code = 'RUN_ALREADY_ACTIVE' as const;

  constructor(productKey: string, activeRunId: string) {
    super(
      `Já existe uma run activa para o produto ${productKey}: ${activeRunId}`,
      { productKey, activeRunId },
    );
  }
}

/**
 * Conflito de decisão: tentativa de registar decisão sobre actividade
 * já decidida sem explicitamente sobrepor a anterior.
 */
export class DecisionConflictError extends ERError {
  readonly code = 'DECISION_CONFLICT' as const;

  constructor(activityId: string, existingDecisionId: string) {
    super(
      `Actividade ${activityId} já tem uma decisão registada: ${existingDecisionId}`,
      { activityId, existingDecisionId },
    );
  }
}

// ── Erros de repositório ──────────────────────────────────────────────

/** Falha genérica de operação no repositório. */
export class RepositoryError extends ERError {
  readonly code = 'REPOSITORY_ERROR' as const;

  constructor(operation: string, table: string, cause: unknown) {
    super(
      `Falha em ${operation} na tabela ${table}: ${String(cause)}`,
      { operation, table, cause: String(cause) },
    );
  }
}

export class ActivityNotFoundError extends ERError {
  readonly code = 'ACTIVITY_NOT_FOUND' as const;

  constructor(activityId: string) {
    super(`Actividade não encontrada: ${activityId}`, { activityId });
  }
}

export class VenueNotFoundError extends ERError {
  readonly code = 'VENUE_NOT_FOUND' as const;

  constructor(venueId: string) {
    super(`Venue não encontrado: ${venueId}`, { venueId });
  }
}

// ── Type guard ──────────────────────────────────────────────────────────

export function isERError(e: unknown): e is ERError {
  return e instanceof ERError;
}
