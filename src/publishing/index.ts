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
