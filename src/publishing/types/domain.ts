/**
 * src/publishing/types/domain.ts
 *
 * Tipos de domínio do Publishing Engine.
 * Zero acoplamento a Supabase, Hono ou qualquer framework externo.
 */

// ── Branded IDs ───────────────────────────────────────────────────────────────

export type PublicationRunId    = string & { readonly _brand: 'PublicationRunId' };
export type PublicVenueId       = string & { readonly _brand: 'PublicVenueId' };
export type PublicActivityId    = string & { readonly _brand: 'PublicActivityId' };
export type PublicationEventId  = string & { readonly _brand: 'PublicationEventId' };

// Reutilizados de staging (sem redefinir)
export type StagingVenueId      = string & { readonly _brand: 'StagingVenueId' };
export type StagingActivityId   = string & { readonly _brand: 'StagingActivityId' };

// ── Engine status ─────────────────────────────────────────────────────────────

export type EngineStatus = 'active' | 'archived' | 'draft';

// ── Publishable venue — o que o engine lê de staging ─────────────────────────

/**
 * Venue pronto para publicação — JOIN de venues_staging + raw_venue_items.
 * Inclui apenas os campos que o engine precisa para publicar (whitelist ADR-0018).
 */
export interface PublishableVenue {
  readonly stagingId:          StagingVenueId;
  readonly productKey:         string;
  readonly sourceKey:          string;
  readonly name:               string;
  readonly address:            string | null;
  readonly lat:                number | null;
  readonly lng:                number | null;
  readonly phone:              string | null;
  readonly website:            string | null;
  readonly openingHoursRaw:    string | null;
  readonly imageUrl:           string | null;
  readonly promotedVenueId:    PublicVenueId | null;  // null = nunca publicado
  readonly stagingUpdatedAt:   Date;
}

// ── Publishable activity — o que o engine lê de staging ──────────────────────

export interface PublishableActivity {
  readonly stagingId:              StagingActivityId;
  readonly productKey:             string;
  readonly sourceKey:              string;
  readonly title:                  string;
  readonly description:            string | null;
  readonly startDate:              Date | null;
  readonly endDate:                Date | null;
  readonly imageUrl:               string | null;
  readonly sourceUrl:              string | null;
  readonly phone:                  string | null;
  // venue resolvido → public.venues.id (null para proposed_new)
  readonly resolvedPublicVenueId:  PublicVenueId | null;
  readonly promotedActivityId:     PublicActivityId | null;
  readonly stagingUpdatedAt:       Date;
}

// ── Publication run ────────────────────────────────────────────────────────────

export type PublicationRunStatus = 'running' | 'success' | 'partial' | 'failed';

export interface PublicationRunMetrics {
  readonly venuesPublished:      number;
  readonly venuesUpdated:        number;
  readonly venuesSkipped:        number;
  readonly venuesArchived:       number;
  readonly activitiesPublished:  number;
  readonly activitiesUpdated:    number;
  readonly activitiesSkipped:    number;
  readonly activitiesArchived:   number;
  readonly errors:               number;
  readonly durationMs:           number;
}

export interface PublicationRunSummary {
  readonly runId:        PublicationRunId;
  readonly productKey:   string;
  readonly triggeredBy:  string;
  readonly status:       PublicationRunStatus;
  readonly startedAt:    Date;
  readonly finishedAt:   Date | null;
  readonly metrics:      PublicationRunMetrics | null;
}

// ── Publication event ─────────────────────────────────────────────────────────

export type PublicationEventType =
  | 'VenuePublished'
  | 'VenueUpdated'
  | 'VenueArchived'
  | 'ActivityPublished'
  | 'ActivityUpdated'
  | 'ActivityArchived'
  | 'PublicationRunCompleted'
  | 'PublicationRunFailed';

export type PublicationEntityType = 'venue' | 'activity' | 'run';

export interface PublicationEvent {
  readonly eventType:    PublicationEventType;
  readonly entityType:   PublicationEntityType;
  readonly entityId:     string;
  readonly productKey:   string;
  readonly runId:        PublicationRunId;
  readonly payload:      Record<string, unknown>;
}
