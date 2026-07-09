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

// ── Publication state — leitura aditiva em IPublicVenueRepository (Sprint 8.4) ──
//
// Ajuste arquitectural da Sprint 8.4: substitui a interface temporária
// IPublicVenueLastPublishedAtLookup por um método aditivo directamente em
// IPublicVenueRepository. Mantém a responsabilidade de leitura do estado de
// publicação dentro do repositório da própria entidade, em vez de um
// colaborador externo dedicado só ao dirty check.

/** Estado mínimo de publicação de um venue em public.venues, por engine_venue_id. */
export interface PublicVenuePublicationState {
  readonly publicVenueId:    PublicVenueId;
  readonly lastPublishedAt:  Date;
  readonly engineStatus:     EngineStatus;
}

// ── Operational Model inputs — saída pura do PublicationTransformer (Sprint 8.3) ──
//
// Tipos aditivos. NÃO alteram IPublicVenueRepository nem IPublicActivityRepository,
// que continuam a aceitar PublishableVenue/PublishableActivity (contratos congelados
// da Sprint 8.2). A forma espelha 1:1 a whitelist definitiva do ADR-0018
// (nomes de coluna em snake_case, tal como escritos em public.venues/public.activities).
//
// Decisão arquitectural (revisão da Sprint 8.3, Questão C): na Sprint 8.4,
// VenuePublisher/ActivityPublisher funcionam como Anti-Corruption Layer entre
// este tipo e os repositórios existentes (adaptador temporário de volta para
// PublishableVenue/PublishableActivity). Quando a Fase 8 estabilizar em produção,
// uma refactoração única substitui os contratos dos repositórios para consumirem
// estes tipos directamente.

/**
 * Payload puro resultante de PublishableVenue → public.venues.
 * Corresponde exactamente à whitelist do ADR-0018 — nenhum campo fora dela.
 * last_published_at é sempre injectado pelo chamador (nunca gerado aqui) para
 * manter o Transformer determinístico.
 */
export interface OperationalVenueInput {
  readonly name:               string;
  readonly address:            string | null;
  readonly lat:                number | null;
  readonly lng:                number | null;
  readonly phone:              string | null;
  readonly website:            string | null;
  /** COPY puro de openingHoursRaw — ver TODO no PublicationTransformer (Questão A). */
  readonly opening_hours:      string | null;
  readonly image_url:          string | null;
  readonly engine_venue_id:    StagingVenueId;
  readonly source_key:         string;
  readonly product_key:        string;
  readonly engine_status:      EngineStatus;
  readonly last_published_at:  Date;
}

/**
 * Payload puro resultante de PublishableActivity → public.activities.
 * `imagem_url` mantém o typo intencional documentado no ADR-0015.
 * `venue_id` pode ser null (activities com venue_resolution_status = proposed_new,
 * Architecture Book v1.1 §5.3).
 */
export interface OperationalActivityInput {
  readonly title:               string;
  readonly description:         string | null;
  readonly start_date:          Date | null;
  readonly end_date:            Date | null;
  readonly imagem_url:          string | null;
  readonly url:                 string | null;
  readonly phone:               string | null;
  readonly venue_id:            PublicVenueId | null;
  readonly engine_activity_id:  StagingActivityId;
  readonly source_key:          string;
  readonly product_key:         string;
  readonly engine_status:       EngineStatus;
  readonly last_published_at:   Date;
}
