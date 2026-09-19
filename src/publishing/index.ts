/**
 * src/publishing/index.ts
 * Ponto único de entrada do Publishing Engine.
 */

// Tipos de domínio
export type {
  PublicationRunId,
  PublicVenueId,
  PublicActivityId,
  PublicationEventId,
  StagingVenueId,
  StagingActivityId,
  EngineStatus,
  PublishableVenue,
  PublishableActivity,
  ActivityOccurrence,
  PublicationRunStatus,
  PublicationRunMetrics,
  PublicationRunSummary,
  PublicationEventType,
  PublicationEntityType,
  PublicationEvent,
  OperationalVenueInput,
  OperationalActivityInput,
  PublicVenuePublicationState,
  PublicActivityPublicationState,
} from './types/domain.js';

// Interfaces dos repositórios
export type {
  IPublishableVenueRepository,
  IPublishableActivityRepository,
  IPublicVenueRepository,
  IPublicActivityRepository,
  IPublicationRunRepository,
  IPublicationEventRepository,
  IPublishingRepositorySet,
} from './repositories/interfaces.js';

// Factory
export { PublishingRepositoryFactory } from './repositories/factory.js';

// Transformer (Sprint 8.3) — componente puro, staging → Operational Model
export { PublicationTransformer } from './services/PublicationTransformer.js';

// Selecção de ocorrência (Sprint 8.7, ADR-0020) — função pura isolada
export { selectNextOccurrence, occurrenceToDateRange } from './services/occurrenceSelection.js';

// VenuePublisher (Sprint 8.4) — orquestrador + Anti-Corruption Layer temporário
export { VenuePublisher } from './services/VenuePublisher.js';
export type { VenuePublicationMetrics, VenueDecision } from './services/VenuePublisher.js';

// ActivityPublisher (Sprint 8.5) — orquestrador + Anti-Corruption Layer temporário
export { ActivityPublisher } from './services/ActivityPublisher.js';
export type { ActivityPublicationMetrics, ActivityDecision } from './services/ActivityPublisher.js';

// PublishingEngine (Sprint 8.6) — orquestrador de topo
export { PublishingEngine } from './services/PublishingEngine.js';
export type { PublishingPreview } from './services/PublishingEngine.js';
