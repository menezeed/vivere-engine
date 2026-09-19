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
 * CORRECÇÃO (Level 2 review, PR #1) — semântica de falhas revista. A
 * afirmação anterior ("publish() nunca lança") não era garantida pelo
 * código: runRepo.start(), runRepo.finish() e eventRepo.record() no
 * caminho de sucesso nunca estiveram dentro de nenhum try/catch, e
 * handleFailure() podia lançar por dentro de si mesma se markFailed()/
 * eventRepo.record() falhassem, perdendo a causa original.
 *
 * Semântica real, agora documentada com precisão:
 *   - Falhas de NEGÓCIO (VenuePublisher.publish()/ActivityPublisher.publish()
 *     lançarem, depois de uma run já ter sido criada com sucesso) são
 *     capturadas e convertidas num PublicationRunSummary com status
 *     'failed' — best-effort: mesmo que o próprio registo dessa falha
 *     (markFailed()/evento PublicationRunFailed) também falhe, a causa
 *     original nunca é substituída nem perdida; a falha secundária fica
 *     apenas registada via logger, para investigação.
 *   - Falhas de INFRAESTRUTURA DE LIFECYCLE/TRACKING (runRepo.start(),
 *     runRepo.finish(), eventRepo.record() no caminho de sucesso) PROPAGAM
 *     — publish() pode lançar nestes casos. Não há run para reportar como
 *     'failed' se start() nunca criou uma, e fabricar um resumo de sucesso
 *     quando finish()/o evento de conclusão falham esconderia uma falha
 *     operacional real. O boundary final é a CLI (scripts/publish.ts),
 *     que já trata isto via main().catch().
 *
 * Sprint 8.7 — preview(): coordena VenuePublisher.preview()/
 * ActivityPublisher.preview(), sem criar run nem eventos — modo read-only
 * usado pelo script CLI (`--preview`) antes da primeira publicação real.
 */

import { logger } from '../../lib/logger.js';
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
   * depois activities. Falhas de negócio (publishers) são convertidas num
   * PublicationRunSummary 'failed'. Falhas de infraestrutura de lifecycle
   * (start/finish/eventos) PROPAGAM — ver nota de semântica no cabeçalho
   * do ficheiro.
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

  /**
   * CORRECÇÃO (Level 2 review, PR #1) — markFailed() e o registo do evento
   * PublicationRunFailed passam a ter try/catch próprios. Se qualquer um
   * dos dois falhar, a falha secundária é registada via logger (auditável,
   * não silenciosa) mas NUNCA substitui nem perde a causa original (`err`)
   * — o PublicationRunSummary devolvido continua a reportar 'failed' com a
   * razão de negócio original, mesmo que o próprio registo dessa falha
   * tenha, por sua vez, falhado. handleFailure() nunca lança — se lançasse,
   * a causa original (já capturada no catch de publish()) seria perdida
   * por completo para quem chamou publish().
   */
  private async handleFailure(
    runId:       PublicationRunSummary['runId'],
    productKey:  string,
    triggeredBy: string,
    startedAt:   Date,
    err:         unknown,
  ): Promise<PublicationRunSummary> {
    const reason = err instanceof Error ? err.message : String(err);

    try {
      await this.runRepo.markFailed(runId, reason);
    } catch (markFailedErr) {
      logger.error(
        {
          runId,
          productKey,
          originalReason: reason,
          markFailedError: markFailedErr instanceof Error ? markFailedErr.message : String(markFailedErr),
        },
        'PublishingEngine: falha ao marcar run como failed — causa original de negócio preservada no summary devolvido; registo de lifecycle pode estar inconsistente em public.publication_runs',
      );
    }

    try {
      await this.eventRepo.record({
        eventType:  'PublicationRunFailed',
        entityType: 'run',
        entityId:   runId,
        productKey,
        runId,
        payload: { reason },
      });
    } catch (eventErr) {
      logger.error(
        {
          runId,
          productKey,
          originalReason: reason,
          eventError: eventErr instanceof Error ? eventErr.message : String(eventErr),
        },
        'PublishingEngine: falha ao registar evento PublicationRunFailed — causa original de negócio preservada no summary devolvido',
      );
    }

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
