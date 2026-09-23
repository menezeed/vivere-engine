/**
 * src/publishing/repositories/interfaces.ts
 *
 * Interfaces puras dos repositórios do Publishing Engine.
 * Zero dependência de Supabase. Mesmo padrão da Entity Resolution.
 */

import type {
  PublicationRunId,
  PublicVenueId,
  PublicActivityId,
  PublicationEventId,
  StagingVenueId,
  StagingActivityId,
  EngineActivityId,
  PublishableVenue,
  PublishableActivity,
  PublicationRunStatus,
  PublicationRunSummary,
  PublicationRunMetrics,
  PublicationEvent,
  EngineStatus,
  PublicVenuePublicationState,
  PublicActivityPublicationState,
  ActivityFunnel,
} from '../types/domain.js';

// ── IPublishableVenueRepository ──────────────────────────────────────────

/**
 * Lê venues de staging prontos para publicar.
 * JOIN de venues_staging + raw_venue_items.
 * Filtra por promoted e aplica dirty check.
 */
export interface IPublishableVenueRepository {
  /** Venues promovidos que ainda não foram publicados (promoted_venue_id IS NULL). */
  findUnpublished(productKey: string): Promise<readonly PublishableVenue[]>;

  /**
   * Venues publicados cujos dados em staging mudaram após a última publicação.
   * Dirty check: venues_staging.updated_at > public.venues.last_published_at
   */
  findDirty(productKey: string): Promise<readonly PublishableVenue[]>;

  /**
   * Venues cujo proposal_status mudou para 'rejected' após publicação.
   * Devem ser arquivados em public.venues.
   */
  findToArchive(productKey: string): Promise<readonly PublishableVenue[]>;
}

// ── IPublishableActivityRepository ───────────────────────────────────────

export interface IPublishableActivityRepository {
  /** Activities com decisão humana tomada e ainda não publicadas. */
  findUnpublished(productKey: string): Promise<readonly PublishableActivity[]>;

  /** Activities publicadas com dados alterados em staging. */
  findDirty(productKey: string): Promise<readonly PublishableActivity[]>;

  /**
   * Sprint 8.7 — método aditivo, puramente informativo. Devolve o funil
   * completo de activities_staging para um produto: total, contagem por
   * venue_resolution_status (incluindo estados fora do critério de
   * publicação, ex: 'unresolved'), e quantas já foram publicadas. Usado
   * pelo --preview do publish.ts para explicar por que só um subconjunto
   * é elegível. Nunca usado por findUnpublished()/findDirty()/publish().
   */
  describeFunnel(productKey: string): Promise<ActivityFunnel>;
}

// ── IPublicVenueRepository ────────────────────────────────────────────────

/**
 * Escreve em public.venues.
 * Implementa a metade pública da publicação de venues.
 */
export interface IPublicVenueRepository {
  /** Insere venue em public.venues. Retorna o novo id público. */
  insert(venue: PublishableVenue, runId: PublicationRunId): Promise<PublicVenueId>;

  /** Actualiza venue já publicado. */
  update(publicVenueId: PublicVenueId, venue: PublishableVenue): Promise<void>;

  /** Arquiva venue (engine_status = archived). */
  archive(publicVenueId: PublicVenueId): Promise<void>;

  /**
   * Actualiza promoted_venue_id em staging após INSERT.
   * Parte da transacção atómica — não pode ser em repositório separado
   * porque precisa de ocorrer no mesmo commit.
   */
  linkToStaging(stagingVenueId: StagingVenueId, publicVenueId: PublicVenueId): Promise<void>;

  /** Busca por engine_venue_id — para verificar se já foi publicado. */
  findByEngineId(stagingVenueId: StagingVenueId): Promise<PublicVenueId | null>;

  /**
   * Estado de publicação do venue público (id, last_published_at, engine_status),
   * por engine_venue_id. Método aditivo (Sprint 8.4) — usado pelo VenuePublisher
   * para o dirty check real (staging.updated_at vs public.last_published_at).
   * Null se o venue nunca foi publicado.
   */
  findPublicationStateByEngineId(engineVenueId: StagingVenueId): Promise<PublicVenuePublicationState | null>;
}

// ── IPublicActivityRepository ────────────────────────────────────────────

export interface IPublicActivityRepository {
  /** Insere activity em public.activities. Retorna o novo id público. */
  insert(activity: PublishableActivity, runId: PublicationRunId): Promise<PublicActivityId>;

  /** Actualiza activity já publicada. */
  update(publicActivityId: PublicActivityId, activity: PublishableActivity): Promise<void>;

  /** Arquiva activity (engine_status = archived). */
  archive(publicActivityId: PublicActivityId): Promise<void>;

  /** Actualiza promoted_activity_id em staging após INSERT. */
  linkToStaging(stagingActivityId: StagingActivityId, publicActivityId: PublicActivityId): Promise<void>;

  /**
   * Busca por engine_activity_id.
   *
   * Level 3, 2026-09-23 — Stable Source Activity Identity. Parâmetro
   * mudou de StagingActivityId (staging id bruto, efémero) para
   * EngineActivityId (identidade estável, derivada de source_key +
   * source_item_id via UUIDv5 — ver activityIdentity.ts).
   */
  findByEngineId(engineActivityId: EngineActivityId): Promise<PublicActivityId | null>;

  /**
   * Estado de publicação da activity pública (id, last_published_at, engine_status),
   * por engine_activity_id. Método aditivo (Sprint 8.5) — mesmo padrão de
   * IPublicVenueRepository.findPublicationStateByEngineId (Sprint 8.4).
   * Usado pelo ActivityPublisher para a reconciliação por identidade
   * estável (Level 3, 2026-09-23) antes de decidir insert/update. Null se
   * a activity nunca foi publicada sob esta identidade de fonte.
   *
   * Parâmetro EngineActivityId, não StagingActivityId — mesma mudança que
   * findByEngineId() acima.
   */
  findPublicationStateByEngineId(engineActivityId: EngineActivityId): Promise<PublicActivityPublicationState | null>;
}

// ── IPublicationRunRepository ────────────────────────────────────────────

export interface IPublicationRunRepository {
  /** Inicia uma nova run. Retorna o runId. */
  start(productKey: string, triggeredBy: string): Promise<PublicationRunId>;

  /** Fecha a run com sucesso e persiste métricas. */
  finish(runId: PublicationRunId, metrics: PublicationRunMetrics): Promise<void>;

  /** Marca a run como failed. */
  markFailed(runId: PublicationRunId, reason: string): Promise<void>;

  /** Retorna a run activa de um produto (null se não existir). */
  findActive(productKey: string): Promise<PublicationRunSummary | null>;

  /** Retorna a última run concluída de um produto. */
  findLastCompleted(productKey: string): Promise<PublicationRunSummary | null>;
}

// ── IPublicationEventRepository ──────────────────────────────────────────

export interface IPublicationEventRepository {
  /** Regista um evento de publicação. Append-only. */
  record(event: PublicationEvent): Promise<PublicationEventId>;
}

// ── IPublishingRepositorySet ──────────────────────────────────────────────

/**
 * Conjunto completo de repositórios do Publishing Engine.
 * Análogo a IEntityResolutionRepositorySet.
 * O PublishingEngine recebe este set — nunca as implementações concretas.
 */
export interface IPublishingRepositorySet {
  readonly publishableVenue:    IPublishableVenueRepository;
  readonly publishableActivity: IPublishableActivityRepository;
  readonly publicVenue:         IPublicVenueRepository;
  readonly publicActivity:      IPublicActivityRepository;
  readonly run:                 IPublicationRunRepository;
  readonly event:               IPublicationEventRepository;
}
