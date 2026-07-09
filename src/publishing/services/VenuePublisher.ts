/**
 * src/publishing/services/VenuePublisher.ts
 *
 * Sprint 8.4 — Publishing Engine.
 *
 * Orquestra a publicação de venues: busca venues publicáveis, aplica dirty
 * check, chama PublicationTransformer.transformVenue(), adapta o resultado
 * de volta para o contrato temporário de IPublicVenueRepository (Sprint 8.2),
 * grava em public.venues, actualiza promoted_venue_id em staging, regista
 * eventos e devolve métricas.
 *
 * VenuePublisher é o Anti-Corruption Layer temporário decidido na revisão
 * arquitectural da Sprint 8.3 (Questão C):
 *
 *   PublishableVenue → PublicationTransformer → OperationalVenueInput
 *     → VenuePublisher (ACL) → PublishableVenue (adaptador) → PublicVenueRepository
 *
 * Depende apenas de três colaboradores — IPublishableVenueRepository,
 * IPublicVenueRepository, IPublicationEventRepository. O dirty check real
 * (staging.updated_at vs public.last_published_at) usa
 * IPublicVenueRepository.findPublicationStateByEngineId(), um método
 * ADITIVO introduzido nesta sprint (ajuste arquitectural pós-revisão):
 * mantém a leitura do estado de publicação dentro do repositório da própria
 * entidade, em vez de um colaborador externo dedicado só a essa leitura.
 * Nenhum método existente de IPublicVenueRepository foi alterado ou removido.
 *
 * IPublishableVenueRepository não é alterado nesta sprint. Quando a Fase 8
 * estabilizar em produção, uma refactoração única substitui os contratos dos
 * repositórios para consumirem OperationalVenueInput directamente — nessa
 * altura o passo de adaptação aqui implementado é removido, mas as chamadas
 * ao Transformer mantêm-se.
 */

import { PublicationTransformer } from './PublicationTransformer.js';
import type {
  IPublishableVenueRepository,
  IPublicVenueRepository,
  IPublicationEventRepository,
} from '../repositories/interfaces.js';
import type {
  PublishableVenue,
  OperationalVenueInput,
  PublicationRunId,
} from '../types/domain.js';

// ── Métricas parciais de venues ───────────────────────────────────────────────
//
// Subconjunto de PublicationRunMetrics relativo apenas a venues. A fusão com
// as métricas de activities (ActivityPublisher, Sprint 8.5) e o registo em
// public.publication_runs são responsabilidade do PublishingEngine (Sprint 8.6).

export interface VenuePublicationMetrics {
  readonly venuesPublished: number;
  readonly venuesUpdated:   number;
  readonly venuesSkipped:   number;
  readonly venuesArchived:  number;
  readonly errors:          number;
  readonly durationMs:      number;
}

export class VenuePublisher {
  constructor(
    private readonly publishableVenueRepo: IPublishableVenueRepository,
    private readonly publicVenueRepo: IPublicVenueRepository,
    private readonly eventRepo: IPublicationEventRepository,
    /** Injectável para testes. Por omissão, relógio real. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Publica todos os venues pendentes (novos, dirty, a arquivar) de um produto.
   * Cada venue é processado isoladamente — um erro num venue não interrompe
   * o processamento dos restantes; é contabilizado em `errors`.
   */
  async publish(productKey: string, runId: PublicationRunId): Promise<VenuePublicationMetrics> {
    const startedAt = this.clock();

    let venuesPublished = 0;
    let venuesUpdated   = 0;
    let venuesSkipped    = 0;
    let venuesArchived   = 0;
    let errors           = 0;

    const [unpublished, dirtyCandidates, toArchive] = await Promise.all([
      this.publishableVenueRepo.findUnpublished(productKey),
      this.publishableVenueRepo.findDirty(productKey),
      this.publishableVenueRepo.findToArchive(productKey),
    ]);

    for (const venue of unpublished) {
      try {
        await this.publishNew(venue, runId, productKey);
        venuesPublished++;
      } catch {
        errors++;
      }
    }

    for (const venue of dirtyCandidates) {
      try {
        const wasUpdated = await this.updateIfDirty(venue, runId, productKey);
        if (wasUpdated) venuesUpdated++;
        else venuesSkipped++;
      } catch {
        errors++;
      }
    }

    for (const venue of toArchive) {
      try {
        await this.archive(venue, runId, productKey);
        venuesArchived++;
      } catch {
        errors++;
      }
    }

    const durationMs = this.clock().getTime() - startedAt.getTime();

    return { venuesPublished, venuesUpdated, venuesSkipped, venuesArchived, errors, durationMs };
  }

  // ── Primeira publicação (promoted_venue_id IS NULL) ─────────────────────────

  private async publishNew(venue: PublishableVenue, runId: PublicationRunId, productKey: string): Promise<void> {
    const operational = PublicationTransformer.transformVenue(venue, this.clock());
    const adapted      = VenuePublisher.adaptToPublishableVenue(operational, venue);

    const publicVenueId = await this.publicVenueRepo.insert(adapted, runId);
    await this.publicVenueRepo.linkToStaging(venue.stagingId, publicVenueId);

    await this.eventRepo.record({
      eventType:  'VenuePublished',
      entityType: 'venue',
      entityId:   publicVenueId,
      productKey,
      runId,
      payload: { name: operational.name, engineVenueId: operational.engine_venue_id },
    });
  }

  // ── Republicação com dirty check real ────────────────────────────────────────

  private async updateIfDirty(
    venue: PublishableVenue,
    runId: PublicationRunId,
    productKey: string,
  ): Promise<boolean> {
    const state = await this.publicVenueRepo.findPublicationStateByEngineId(venue.stagingId);
    if (state === null) {
      throw new Error(
        `VenuePublisher.updateIfDirty: staging venue ${venue.stagingId} sem registo correspondente em public.venues`,
      );
    }

    // Dirty check (Architecture Book v1.1 §4 / §4b.2):
    // updated_at > last_published_at → UPDATE. Senão → SKIP, zero writes, zero eventos.
    if (venue.stagingUpdatedAt <= state.lastPublishedAt) {
      return false;
    }

    const operational = PublicationTransformer.transformVenue(venue, this.clock());
    const adapted      = VenuePublisher.adaptToPublishableVenue(operational, venue);

    await this.publicVenueRepo.update(state.publicVenueId, adapted);

    await this.eventRepo.record({
      eventType:  'VenueUpdated',
      entityType: 'venue',
      entityId:   state.publicVenueId,
      productKey,
      runId,
      payload: { name: operational.name, engineVenueId: operational.engine_venue_id },
    });

    return true;
  }

  // ── Arquivação (proposal_status = rejected após publicação) ──────────────────

  private async archive(venue: PublishableVenue, runId: PublicationRunId, productKey: string): Promise<void> {
    if (venue.promotedVenueId === null) {
      throw new Error('VenuePublisher.archive: venue devolvido por findToArchive() sem promotedVenueId');
    }

    await this.publicVenueRepo.archive(venue.promotedVenueId);

    await this.eventRepo.record({
      eventType:  'VenueArchived',
      entityType: 'venue',
      entityId:   venue.promotedVenueId,
      productKey,
      runId,
      payload: { stagingId: venue.stagingId },
    });
  }

  // ── Anti-Corruption Layer — OperationalVenueInput → PublishableVenue ─────────
  //
  // Função pura. Reconstrói o formato aceite por IPublicVenueRepository
  // (contrato congelado da Sprint 8.2) a partir da saída do Transformer.
  // Campos que OperationalVenueInput não carrega (promotedVenueId,
  // stagingUpdatedAt) vêm do PublishableVenue original — o repositório
  // não os usa para escrita (ADR-0018), mas fazem parte da forma do tipo.
  // engine_status e last_published_at do Transformer NÃO são usados aqui:
  // o repositório continua a gerá-los internamente (comportamento congelado
  // da Sprint 8.2) — este adaptador é temporário e será removido quando os
  // repositórios passarem a consumir OperationalVenueInput directamente.

  static adaptToPublishableVenue(operational: OperationalVenueInput, original: PublishableVenue): PublishableVenue {
    return {
      stagingId:        operational.engine_venue_id,
      productKey:       operational.product_key,
      sourceKey:        operational.source_key,
      name:             operational.name,
      address:          operational.address,
      lat:              operational.lat,
      lng:              operational.lng,
      phone:            operational.phone,
      website:          operational.website,
      openingHoursRaw:  operational.opening_hours,
      imageUrl:         operational.image_url,
      promotedVenueId:  original.promotedVenueId,
      stagingUpdatedAt: original.stagingUpdatedAt,
    };
  }
}
