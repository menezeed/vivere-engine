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
  PublicationRunStatus,
  PublicationRunMetrics,
  PublicationRunSummary,
  PublicationEventType,
  PublicationEntityType,
  PublicationEvent,
  OperationalVenueInput,
  OperationalActivityInput,
  PublicVenuePublicationState,
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

// VenuePublisher (Sprint 8.4) — orquestrador + Anti-Corruption Layer temporário
export { VenuePublisher } from './services/VenuePublisher.js';
export type { VenuePublicationMetrics } from './services/VenuePublisher.js';
