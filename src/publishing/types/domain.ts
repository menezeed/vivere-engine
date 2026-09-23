/**
 * src/publishing/types/domain.ts
 *
 * Tipos de domínio do Publishing Engine.
 * Zero acoplamento a Supabase, Hono ou qualquer framework externo.
 */

// ── Branded IDs ──────────────────────────────────────────────────────────

export type PublicationRunId    = string & { readonly _brand: 'PublicationRunId' };
export type PublicVenueId       = string & { readonly _brand: 'PublicVenueId' };
export type PublicActivityId    = string & { readonly _brand: 'PublicActivityId' };
export type PublicationEventId  = string & { readonly _brand: 'PublicationEventId' };

// Reutilizados de staging (sem redefinir)
export type StagingVenueId      = string & { readonly _brand: 'StagingVenueId' };
export type StagingActivityId   = string & { readonly _brand: 'StagingActivityId' };

/**
 * Stable Source Activity Identity (Level 3, 2026-09-23).
 *
 * Identidade de uma activity DENTRO da Engine, estável entre execuções de
 * ingestão — ao contrário de StagingActivityId (activities_staging.id),
 * que é sempre novo a cada ingestion_run (raw_activity_items é append-only,
 * a mesma activity real recolhida de novo gera uma linha de staging nova).
 *
 * Derivado deterministicamente de (source_key, source_item_id) via UUIDv5
 * — ver src/publishing/services/activityIdentity.ts. Tipo próprio,
 * deliberadamente distinto de StagingActivityId, para o compilador nunca
 * deixar passar um staging_id efémero onde uma identidade estável é
 * esperada (ou vice-versa).
 */
export type EngineActivityId    = string & { readonly _brand: 'EngineActivityId' };

// ── Engine status ────────────────────────────────────────────────────────

export type EngineStatus = 'active' | 'archived' | 'draft';

// ── Publishable venue — o que o engine lê de staging ────────────────────

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
  /**
   * Sprint 8.7 — venues_staging.city. Puramente informativo (relatório de
   * duplicados no preview, ver duplicateDetection.ts). NUNCA usado por
   * PublicationTransformer nem escrito em public.venues — ADR-0018 exclui
   * `city` da whitelist explicitamente.
   */
  readonly city:               string | null;
}

// ── Publishable activity — o que o engine lê de staging ──────────────────

/**
 * Uma ocorrência de raw_activity_items.occurrences (Sprint 8.7 / ADR-0020).
 * date/time/endDate/endTime na forma bruta como persistidos (strings), sem
 * conversão para Date aqui — a combinação date+time e a selecção de qual
 * ocorrência usar são responsabilidade pura do PublicationTransformer
 * (dependem de `asOf`, que tem de ser injectado, nunca lido do relógio local).
 */
export interface ActivityOccurrence {
  readonly date:     string;       // 'YYYY-MM-DD'
  readonly time:     string | null; // 'HH:MM'
  readonly endDate:  string | null;
  readonly endTime:  string | null;
}

export interface PublishableActivity {
  readonly stagingId:              StagingActivityId;
  readonly productKey:             string;
  readonly sourceKey:              string;
  /**
   * Stable Source Activity Identity (Level 3, 2026-09-23) —
   * raw_activity_items.source_item_id. Junto com sourceKey, forma a
   * identidade estável de fonte usada para derivar EngineActivityId
   * (deriveEngineActivityId). Estável entre execuções para o mesmo post/
   * sub-evento (confirmado: posicional mas determinístico para o mesmo
   * conteúdo HTML — ver investigação de identidade, 2026-09-21/22).
   */
  readonly sourceItemId:           string;
  readonly title:                  string;
  readonly description:            string | null;
  /**
   * Fonte completa de datas (ADR-0020) — raw_activity_items.occurrences,
   * já parseado (tolerante a array nativo ou string JSON legada — ver
   * PublishableActivityRepository). Único array vazio nunca ocorre na
   * leitura real (occurrences é sempre not-null em raw_activity_items,
   * confirmado na Sprint 8.7), mas o tipo permite-o defensivamente.
   */
  readonly occurrences:            readonly ActivityOccurrence[];
  /**
   * Placeholders quando lida directamente de staging — nunca populados por
   * PublishableActivityRepository (occurrences é a fonte de verdade). Só
   * ganham significado numa instância reconstruída por
   * ActivityPublisher.adaptToPublishableActivity (Sprint 8.6/8.7), a partir
   * da ocorrência já seleccionada pelo Transformer.
   */
  readonly startDate:              Date | null;
  readonly endDate:                Date | null;
  readonly imageUrl:               string | null;
  readonly sourceUrl:              string | null;
  readonly phone:                  string | null;
  // venue resolvido → public.venues.id (null para proposed_new OU para
  // matched cujo venue ainda não foi promovido — ver venueResolutionStatus)
  readonly resolvedPublicVenueId:  PublicVenueId | null;
  /**
   * Sprint 8.7 — activities_staging.venue_resolution_status ('matched' |
   * 'proposed_new'; 'unresolved' nunca aparece aqui, já filtrado pela query).
   * Necessário para distinguir, quando resolvedPublicVenueId é null, entre:
   *   - proposed_new genuína (nunca terá venue_id, por desenho);
   *   - matched cujo venue staging ainda não foi promovido — no preview,
   *     porque VenuePublisher ainda não correu nesta run (nunca acontece na
   *     execução real, onde venues são sempre publicados primeiro).
   */
  readonly venueResolutionStatus:  'matched' | 'proposed_new';
  /**
   * Sprint 8.7 — activities_staging.resolved_venue_staging_id, sem passar
   * pelo mapeamento para public venue id. Presente sempre que
   * venueResolutionStatus = 'matched'; null para proposed_new. Usado pelo
   * preview do publish.ts para cruzar com as decisões de venues (venue
   * ainda por publicar nesta mesma run → PENDING_PUBLICATION).
   */
  readonly resolvedVenueStagingId: StagingVenueId | null;
  readonly promotedActivityId:     PublicActivityId | null;
  readonly stagingUpdatedAt:       Date;
}

// ── Publication run ────────────────────────────────────────────────────

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

// ── Publication event ──────────────────────────────────────────────────

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

/** Estado mínimo de publicação de uma activity em public.activities, por engine_activity_id. */
export interface PublicActivityPublicationState {
  readonly publicActivityId: PublicActivityId;
  readonly lastPublishedAt:  Date;
  readonly engineStatus:     EngineStatus;
}

/**
 * Sprint 8.7 — funil de elegibilidade de activities_staging, para o
 * --preview explicar exactamente quantas activities existem, por que
 * estados, e quantas ficam de fora do critério de publicação (venue_resolution_status
 * IN ('matched','proposed_new')). Método aditivo em IPublishableActivityRepository
 * (describeFunnel) — puramente informativo, nunca usado por
 * findUnpublished()/findDirty()/publish().
 */
export interface ActivityFunnel {
  readonly total:                   number;
  /** Contagem por venue_resolution_status, incluindo estados fora do critério de publicação (ex: 'unresolved'). */
  readonly byVenueResolutionStatus: Readonly<Record<string, number>>;
  /** De entre matched+proposed_new, quantas já têm promoted_activity_id preenchido. */
  readonly alreadyPublished:        number;
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
 *
 * `engine_activity_id: EngineActivityId` (Level 3, 2026-09-23) — antes era
 * StagingActivityId; ver activityIdentity.ts para a mudança de contrato.
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
  readonly engine_activity_id:  EngineActivityId;
  readonly source_key:          string;
  readonly product_key:         string;
  readonly engine_status:       EngineStatus;
  readonly last_published_at:   Date;
}
