/**
 * src/publishing/services/PublishingEngine.ts
 *
 * Sprint 8.6 — Publishing Engine.
 *
 * Orquestrador de topo. Coordena VenuePublisher e ActivityPublisher, gere o
 * ciclo de vida da run (start/finish/markFailed em public.publication_runs)
 * e emite os eventos de nível de run (PublicationRunCompleted / Failed).
 *
 * PublishingEngine NUNCA:
 *   - chama PublicationTransformer directamente;
 *   - chama IPublicVenueRepository/IPublicActivityRepository/
 *     IPublishableVenueRepository/IPublishableActivityRepository directamente;
 *   - toma decisões de negócio (dirty check, whitelist, resolução de venue_id).
 * Todas essas responsabilidades ficam em VenuePublisher e ActivityPublisher.
 * PublishingEngine apenas coordena a ordem de execução, agrega as métricas
 * parciais que cada um devolve, e gere o registo da run — análogo ao papel do
 * EntityResolutionEngine na Fase 7 (orquestrador puro sobre matchers/pipeline).
 *
 * Ordem: venues sempre antes de activities (ADR implícita no fluxo E2E do
 * Architecture Book v1.1 §3) — activities resolvem venue_id a partir de
 * venues_staging.promoted_venue_id, que só reflecte publicações desta run
 * depois de VenuePublisher.publish() ter corrido.
 *
 * publish() nunca lança — falhas catastróficas (ex: erro de rede na leitura
 * inicial de staging) são capturadas, registadas via markFailed() e reflectidas
 * no PublicationRunSummary devolvido (status 'failed'), para uso seguro por
 * scripts/CLI sem necessidade de try/catch externo.
 *
 * Sprint 8.7 — preview(): coordena VenuePublisher.preview()/
 * ActivityPublisher.preview(), sem criar run nem eventos — modo read-only
 * usado pelo script CLI (`--preview`) antes da primeira publicação real.
 */

import type { VenuePublisher, VenuePublicationMetrics, VenueDecision } from './VenuePublisher.js';
import type { ActivityPublisher, ActivityPublicationMetrics, ActivityDecision } from './ActivityPublisher.js';
import type {
  IPublicationRunRepository,
  IPublicationEventRepository,
} from '../repositories/interfaces.js';
import type {
  PublicationRunMetrics,
  PublicationRunSummary,
  PublicationRunStatus,
} from '../types/domain.js';

/** Sprint 8.7 — resultado de PublishingEngine.preview(). */
export interface PublishingPreview {
  readonly venues:     readonly VenueDecision[];
  readonly activities: readonly ActivityDecision[];
}

export class PublishingEngine {
  constructor(
    // Pick<..., 'publish' | 'preview'> em vez das classes completas: permite
    // injectar instâncias reais (satisfazem automaticamente) ou mocks
    // estruturais nos testes, sem expor os detalhes internos privados de
    // VenuePublisher/ActivityPublisher.
    private readonly venuePublisher: Pick<VenuePublisher, 'publish' | 'preview'>,
    private readonly activityPublisher: Pick<ActivityPublisher, 'publish' | 'preview'>,
    private readonly runRepo: IPublicationRunRepository,
    private readonly eventRepo: IPublicationEventRepository,
    /** Injectável para testes. Por omissão, relógio real. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Sprint 8.7 — calcula as decisões de venues e activities sem executar
   * nenhuma escrita: zero insert/update/archive/linkToStaging/eventos, e
   * NENHUMA run é criada em public.publication_runs (preview não gera
   * histórico persistido — reflecte fielmente "nada foi escrito"). Reusa
   * VenuePublisher.preview()/ActivityPublisher.preview(), que partilham a
   * mesma lógica de decisão de publish() — sem risco de divergência.
   */
  async preview(productKey: string): Promise<PublishingPreview> {
    const venues     = await this.venuePublisher.preview(productKey);
    const activities = await this.activityPublisher.preview(productKey);
    return { venues, activities };
  }

  /**
   * Executa uma run completa de publicação para um produto: venues primeiro,
   * depois activities. Sempre devolve um PublicationRunSummary — nunca lança.
   */
  async publish(productKey: string, triggeredBy: string): Promise<PublicationRunSummary> {
    const startedAt = this.clock();
    const runId = await this.runRepo.start(productKey, triggeredBy);

    let venueMetrics: VenuePublicationMetrics;
    let activityMetrics: ActivityPublicationMetrics;

    try {
      venueMetrics    = await this.venuePublisher.publish(productKey, runId);
      activityMetrics = await this.activityPublisher.publish(productKey, runId);
    } catch (err) {
      return this.handleFailure(runId, productKey, triggeredBy, startedAt, err);
    }

    const metrics: PublicationRunMetrics = {
      venuesPublished:     venueMetrics.venuesPublished,
      venuesUpdated:       venueMetrics.venuesUpdated,
      venuesSkipped:       venueMetrics.venuesSkipped,
      venuesArchived:      venueMetrics.venuesArchived,
      activitiesPublished: activityMetrics.activitiesPublished,
      activitiesUpdated:   activityMetrics.activitiesUpdated,
      activitiesSkipped:   activityMetrics.activitiesSkipped,
      activitiesArchived:  activityMetrics.activitiesArchived,
      errors:              venueMetrics.errors + activityMetrics.errors,
      durationMs:          this.clock().getTime() - startedAt.getTime(),
    };

    await this.runRepo.finish(runId, metrics);

    const finishedAt = this.clock();
    const status: PublicationRunStatus = metrics.errors > 0 ? 'partial' : 'success';

    await this.eventRepo.record({
      eventType:  'PublicationRunCompleted',
      entityType: 'run',
      entityId:   runId,
      productKey,
      runId,
      payload: { status, metrics },
    });

    return { runId, productKey, triggeredBy, status, startedAt, finishedAt, metrics };
  }

  private async handleFailure(
    runId:       PublicationRunSummary['runId'],
    productKey:  string,
    triggeredBy: string,
    startedAt:   Date,
    err:         unknown,
  ): Promise<PublicationRunSummary> {
    const reason = err instanceof Error ? err.message : String(err);

    await this.runRepo.markFailed(runId, reason);

    await this.eventRepo.record({
      eventType:  'PublicationRunFailed',
      entityType: 'run',
      entityId:   runId,
      productKey,
      runId,
      payload: { reason },
    });

    return {
      runId,
      productKey,
      triggeredBy,
      status:     'failed',
      startedAt,
      finishedAt: this.clock(),
      metrics:    null,
    };
  }
}
