/**
 * src/publishing/services/VenuePublisher.ts
 *
 * Sprint 8.4/8.7 — Publishing Engine.
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
 * usa IPublicVenueRepository.findPublicationStateByEngineId() (método
 * aditivo, Sprint 8.4).
 *
 * Sprint 8.7 — preview(): publish() e preview() partilham exactamente a
 * mesma lógica de decisão (buildInsertDecision/buildDirtyDecision/
 * buildArchiveDecision) — só a execução diverge. publish() chama
 * executeDecision() (escreve); preview() nunca chama executeDecision(),
 * devolve as decisões tal como calculadas. Isto garante que o preview não
 * pode divergir do comportamento real — não é uma segunda implementação
 * paralela da mesma lógica.
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
  PublicVenueId,
  PublicationRunId,
} from '../types/domain.js';

// ── Métricas parciais de venues ───────────────────────────────────────────────

export interface VenuePublicationMetrics {
  readonly venuesPublished: number;
  readonly venuesUpdated:   number;
  readonly venuesSkipped:   number;
  readonly venuesArchived:  number;
  readonly errors:          number;
  readonly durationMs:      number;
}

// ── Decisão por venue (Sprint 8.7) ────────────────────────────────────────────
//
// Resultado puro de "o que fazer com este venue" — calculado por
// buildInsertDecision/buildDirtyDecision/buildArchiveDecision, sem qualquer
// escrita. `venue` (PublishableVenue original) vai sempre incluído, para que
// tanto executeDecision() como o consumidor de preview() (o script CLI)
// tenham tudo o que precisam sem nova leitura.

export type VenueDecision =
  | { readonly action: 'insert';         readonly venue: PublishableVenue; readonly operational: OperationalVenueInput }
  | { readonly action: 'update';         readonly venue: PublishableVenue; readonly operational: OperationalVenueInput; readonly publicVenueId: PublicVenueId }
  | { readonly action: 'skip_not_dirty'; readonly venue: PublishableVenue; readonly publicVenueId: PublicVenueId }
  | { readonly action: 'archive';        readonly venue: PublishableVenue; readonly publicVenueId: PublicVenueId }
  | { readonly action: 'error';          readonly venue: PublishableVenue; readonly reason: string };

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
    const now = startedAt;

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
        const decision = this.buildInsertDecision(venue, now);
        await this.executeDecision(decision, runId, productKey);
        venuesPublished++;
      } catch {
        errors++;
      }
    }

    for (const venue of dirtyCandidates) {
      try {
        const decision = await this.buildDirtyDecision(venue, now);
        if (decision.action === 'error') throw new Error(decision.reason);
        await this.executeDecision(decision, runId, productKey);
        if (decision.action === 'update') venuesUpdated++;
        else venuesSkipped++; // skip_not_dirty
      } catch {
        errors++;
      }
    }

    for (const venue of toArchive) {
      try {
        const decision = this.buildArchiveDecision(venue);
        if (decision.action === 'error') throw new Error(decision.reason);
        await this.executeDecision(decision, runId, productKey);
        venuesArchived++;
      } catch {
        errors++;
      }
    }

    const durationMs = this.clock().getTime() - startedAt.getTime();

    return { venuesPublished, venuesUpdated, venuesSkipped, venuesArchived, errors, durationMs };
  }

  /**
   * Sprint 8.7 — calcula as decisões para todos os venues pendentes de um
   * produto, SEM executar nenhuma escrita (zero insert/update/archive/
   * linkToStaging/eventos). Usa exactamente os mesmos builders que publish().
   */
  async preview(productKey: string): Promise<readonly VenueDecision[]> {
    const now = this.clock();
    const decisions: VenueDecision[] = [];

    const [unpublished, dirtyCandidates, toArchive] = await Promise.all([
      this.publishableVenueRepo.findUnpublished(productKey),
      this.publishableVenueRepo.findDirty(productKey),
      this.publishableVenueRepo.findToArchive(productKey),
    ]);

    for (const venue of unpublished) {
      decisions.push(this.buildInsertDecision(venue, now));
    }

    for (const venue of dirtyCandidates) {
      try {
        decisions.push(await this.buildDirtyDecision(venue, now));
      } catch (err) {
        decisions.push({ action: 'error', venue, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    for (const venue of toArchive) {
      decisions.push(this.buildArchiveDecision(venue));
    }

    return decisions;
  }

  // ── Builders de decisão — puros/só-leitura, partilhados por publish() e preview() ──

  private buildInsertDecision(venue: PublishableVenue, now: Date): VenueDecision {
    const operational = PublicationTransformer.transformVenue(venue, now);
    return { action: 'insert', venue, operational };
  }

  private async buildDirtyDecision(venue: PublishableVenue, now: Date): Promise<VenueDecision> {
    const state = await this.publicVenueRepo.findPublicationStateByEngineId(venue.stagingId);
    if (state === null) {
      return {
        action: 'error',
        venue,
        reason: `staging venue ${venue.stagingId} sem registo correspondente em public.venues`,
      };
    }

    // Dirty check (Architecture Book v1.1 §4 / §4b.2):
    // updated_at > last_published_at → update. Senão → skip, zero writes, zero eventos.
    if (venue.stagingUpdatedAt <= state.lastPublishedAt) {
      return { action: 'skip_not_dirty', venue, publicVenueId: state.publicVenueId };
    }

    const operational = PublicationTransformer.transformVenue(venue, now);
    return { action: 'update', venue, operational, publicVenueId: state.publicVenueId };
  }

  private buildArchiveDecision(venue: PublishableVenue): VenueDecision {
    if (venue.promotedVenueId === null) {
      return { action: 'error', venue, reason: 'venue devolvido por findToArchive() sem promotedVenueId' };
    }
    return { action: 'archive', venue, publicVenueId: venue.promotedVenueId };
  }

  // ── Execução — só chamada por publish(), nunca por preview() ─────────────────

  private async executeDecision(decision: VenueDecision, runId: PublicationRunId, productKey: string): Promise<void> {
    switch (decision.action) {
      case 'insert': {
        const adapted = VenuePublisher.adaptToPublishableVenue(decision.operational, decision.venue);
        const publicVenueId = await this.publicVenueRepo.insert(adapted, runId);
        await this.publicVenueRepo.linkToStaging(decision.venue.stagingId, publicVenueId);
        await this.eventRepo.record({
          eventType:  'VenuePublished',
          entityType: 'venue',
          entityId:   publicVenueId,
          productKey,
          runId,
          payload: { name: decision.operational.name, engineVenueId: decision.operational.engine_venue_id },
        });
        return;
      }
      case 'update': {
        const adapted = VenuePublisher.adaptToPublishableVenue(decision.operational, decision.venue);
        await this.publicVenueRepo.update(decision.publicVenueId, adapted);
        await this.eventRepo.record({
          eventType:  'VenueUpdated',
          entityType: 'venue',
          entityId:   decision.publicVenueId,
          productKey,
          runId,
          payload: { name: decision.operational.name, engineVenueId: decision.operational.engine_venue_id },
        });
        return;
      }
      case 'archive': {
        await this.publicVenueRepo.archive(decision.publicVenueId);
        await this.eventRepo.record({
          eventType:  'VenueArchived',
          entityType: 'venue',
          entityId:   decision.publicVenueId,
          productKey,
          runId,
          payload: { stagingId: decision.venue.stagingId },
        });
        return;
      }
      case 'skip_not_dirty':
      case 'error':
        return; // zero writes, zero eventos
    }
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
      city:             original.city, // pass-through, não usado na escrita
    };
  }
}
