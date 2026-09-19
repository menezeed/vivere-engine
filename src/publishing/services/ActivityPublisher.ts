/**
 * src/publishing/services/ActivityPublisher.ts
 *
 * Sprint 8.5/8.7 — Publishing Engine.
 *
 * Orquestra a publicação de activities: busca activities publicáveis (já com
 * venue_id resolvido pelo PublishableActivityRepository — Sprint 8.2), aplica
 * dirty check, chama PublicationTransformer.transformActivity(), adapta o
 * resultado de volta para o contrato temporário de IPublicActivityRepository,
 * grava em public.activities, actualiza promoted_activity_id em staging,
 * regista eventos e devolve métricas.
 *
 * Mesmo padrão do VenuePublisher: três colaboradores —
 * IPublishableActivityRepository, IPublicActivityRepository,
 * IPublicationEventRepository. Dirty check via
 * IPublicActivityRepository.findPublicationStateByEngineId().
 *
 * ADR-0020 (Sprint 8.7): activities podem ter múltiplas ocorrências
 * (raw_activity_items.occurrences). PublicationTransformer.transformActivity
 * selecciona a próxima ocorrência futura (>= asOf, sempre injectado) e
 * devolve null quando nenhuma existe — a decisão sobre esse null (nunca
 * inserir vs arquivar) é tomada aqui, nos builders de decisão.
 *
 * Sprint 8.7 — preview(): publish() e preview() partilham exactamente a
 * mesma lógica de decisão (buildInsertDecision/buildDirtyDecision) — só a
 * execução diverge, tal como em VenuePublisher. Garante que o preview nunca
 * diverge do comportamento real.
 *
 * Arquivação manual (archiveActivity()): capacidade explícita, separada do
 * fluxo de decisão de publish()/preview() — ver nota completa mais abaixo.
 */

import { PublicationTransformer } from './PublicationTransformer.js';
import type {
  IPublishableActivityRepository,
  IPublicActivityRepository,
  IPublicationEventRepository,
} from '../repositories/interfaces.js';
import type {
  PublishableActivity,
  OperationalActivityInput,
  PublicActivityId,
  StagingActivityId,
  PublicationRunId,
} from '../types/domain.js';

// ── Métricas parciais de activities ───────────────────────────────────────────

export interface ActivityPublicationMetrics {
  readonly activitiesPublished: number;
  readonly activitiesUpdated:   number;
  readonly activitiesSkipped:   number;
  readonly activitiesArchived:  number;
  readonly errors:              number;
  readonly durationMs:          number;
}

// ── Decisão por activity (Sprint 8.7) ─────────────────────────────────────────

export type ActivityDecision =
  | { readonly action: 'insert';          readonly activity: PublishableActivity; readonly operational: OperationalActivityInput }
  | { readonly action: 'update';          readonly activity: PublishableActivity; readonly operational: OperationalActivityInput; readonly publicActivityId: PublicActivityId }
  | { readonly action: 'skip_not_dirty';  readonly activity: PublishableActivity; readonly publicActivityId: PublicActivityId }
  | { readonly action: 'skip_expired';    readonly activity: PublishableActivity }
  | { readonly action: 'archive_expired'; readonly activity: PublishableActivity; readonly publicActivityId: PublicActivityId }
  | { readonly action: 'error';           readonly activity: PublishableActivity; readonly reason: string };

export class ActivityPublisher {
  constructor(
    private readonly publishableActivityRepo: IPublishableActivityRepository,
    private readonly publicActivityRepo: IPublicActivityRepository,
    private readonly eventRepo: IPublicationEventRepository,
    /** Injectável para testes. Por omissão, relógio real. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Publica todas as activities pendentes (novas, dirty) de um produto.
   * Cada activity é processada isoladamente — um erro numa activity não
   * interrompe o processamento das restantes; é contabilizado em `errors`.
   * Não descobre nem arquiva activities por outros motivos automaticamente
   * — ver archiveActivity().
   */
  async publish(productKey: string, runId: PublicationRunId): Promise<ActivityPublicationMetrics> {
    const startedAt = this.clock();
    const now = startedAt;

    let activitiesPublished = 0;
    let activitiesUpdated   = 0;
    let activitiesSkipped   = 0;
    let activitiesArchived  = 0;
    let errors              = 0;

    const [unpublished, dirtyCandidates] = await Promise.all([
      this.publishableActivityRepo.findUnpublished(productKey),
      this.publishableActivityRepo.findDirty(productKey),
    ]);

    for (const activity of unpublished) {
      try {
        const decision = this.buildInsertDecision(activity, now);
        await this.executeDecision(decision, runId, productKey);
        if (decision.action === 'insert') activitiesPublished++;
        else activitiesSkipped++; // skip_expired
      } catch {
        errors++;
      }
    }

    for (const activity of dirtyCandidates) {
      try {
        const decision = await this.buildDirtyDecision(activity, now);
        if (decision.action === 'error') throw new Error(decision.reason);
        await this.executeDecision(decision, runId, productKey);
        if (decision.action === 'update') activitiesUpdated++;
        else if (decision.action === 'archive_expired') activitiesArchived++;
        else activitiesSkipped++; // skip_not_dirty
      } catch {
        errors++;
      }
    }

    const durationMs = this.clock().getTime() - startedAt.getTime();

    return { activitiesPublished, activitiesUpdated, activitiesSkipped, activitiesArchived, errors, durationMs };
  }

  /**
   * Sprint 8.7 — calcula as decisões para todas as activities pendentes de
   * um produto, SEM executar nenhuma escrita. Usa exactamente os mesmos
   * builders que publish().
   */
  async preview(productKey: string): Promise<readonly ActivityDecision[]> {
    const now = this.clock();
    const decisions: ActivityDecision[] = [];

    const [unpublished, dirtyCandidates] = await Promise.all([
      this.publishableActivityRepo.findUnpublished(productKey),
      this.publishableActivityRepo.findDirty(productKey),
    ]);

    for (const activity of unpublished) {
      decisions.push(this.buildInsertDecision(activity, now));
    }

    for (const activity of dirtyCandidates) {
      try {
        decisions.push(await this.buildDirtyDecision(activity, now));
      } catch (err) {
        decisions.push({ action: 'error', activity, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    return decisions;
  }

  /**
   * Arquiva uma activity publicada, por engine_activity_id (staging id).
   * Capacidade explícita — ver nota de arquivação no cabeçalho do módulo.
   * Fora do fluxo de decisão de publish()/preview(); não descoberta
   * automaticamente por nenhum dos dois.
   */
  async archiveActivity(
    engineActivityId: StagingActivityId,
    runId: PublicationRunId,
    productKey: string,
  ): Promise<void> {
    const state = await this.publicActivityRepo.findPublicationStateByEngineId(engineActivityId);
    if (state === null) {
      throw new Error(
        `ActivityPublisher.archiveActivity: staging activity ${engineActivityId} sem registo correspondente em public.activities`,
      );
    }

    await this.publicActivityRepo.archive(state.publicActivityId);

    await this.eventRepo.record({
      eventType:  'ActivityArchived',
      entityType: 'activity',
      entityId:   state.publicActivityId,
      productKey,
      runId,
      payload: { reason: 'manual', engineActivityId },
    });
  }

  // ── Builders de decisão — puros/só-leitura, partilhados por publish() e preview() ──

  private buildInsertDecision(activity: PublishableActivity, now: Date): ActivityDecision {
    const operational = PublicationTransformer.transformActivity(activity, now, now);
    if (operational === null) {
      // ADR-0020, regra 5: nunca publicada e sem ocorrência futura → não inserir.
      return { action: 'skip_expired', activity };
    }
    return { action: 'insert', activity, operational };
  }

  private async buildDirtyDecision(activity: PublishableActivity, now: Date): Promise<ActivityDecision> {
    const state = await this.publicActivityRepo.findPublicationStateByEngineId(activity.stagingId);
    if (state === null) {
      return {
        action: 'error',
        activity,
        reason: `staging activity ${activity.stagingId} sem registo correspondente em public.activities`,
      };
    }

    if (activity.stagingUpdatedAt <= state.lastPublishedAt) {
      return { action: 'skip_not_dirty', activity, publicActivityId: state.publicActivityId };
    }

    const operational = PublicationTransformer.transformActivity(activity, now, now);
    if (operational === null) {
      // ADR-0020, regra 5: já publicada, dados novos chegaram (dirty), mas
      // sem ocorrência futura na reavaliação → arquivar.
      return { action: 'archive_expired', activity, publicActivityId: state.publicActivityId };
    }

    return { action: 'update', activity, operational, publicActivityId: state.publicActivityId };
  }

  // ── Execução — só chamada por publish(), nunca por preview() ─────────────────

  private async executeDecision(decision: ActivityDecision, runId: PublicationRunId, productKey: string): Promise<void> {
    switch (decision.action) {
      case 'insert': {
        const adapted = ActivityPublisher.adaptToPublishableActivity(decision.operational, decision.activity);
        const publicActivityId = await this.publicActivityRepo.insert(adapted, runId);
        await this.publicActivityRepo.linkToStaging(decision.activity.stagingId, publicActivityId);
        await this.eventRepo.record({
          eventType:  'ActivityPublished',
          entityType: 'activity',
          entityId:   publicActivityId,
          productKey,
          runId,
          payload: { title: decision.operational.title, engineActivityId: decision.operational.engine_activity_id },
        });
        return;
      }
      case 'update': {
        const adapted = ActivityPublisher.adaptToPublishableActivity(decision.operational, decision.activity);
        await this.publicActivityRepo.update(decision.publicActivityId, adapted);
        await this.eventRepo.record({
          eventType:  'ActivityUpdated',
          entityType: 'activity',
          entityId:   decision.publicActivityId,
          productKey,
          runId,
          payload: { title: decision.operational.title, engineActivityId: decision.operational.engine_activity_id },
        });
        return;
      }
      case 'archive_expired': {
        await this.publicActivityRepo.archive(decision.publicActivityId);
        await this.eventRepo.record({
          eventType:  'ActivityArchived',
          entityType: 'activity',
          entityId:   decision.publicActivityId,
          productKey,
          runId,
          payload: { reason: 'expired', engineActivityId: decision.activity.stagingId },
        });
        return;
      }
      case 'skip_not_dirty':
      case 'skip_expired':
      case 'error':
        return; // zero writes, zero eventos
    }
  }

  // ── Anti-Corruption Layer — OperationalActivityInput → PublishableActivity ───

  static adaptToPublishableActivity(
    operational: OperationalActivityInput,
    original: PublishableActivity,
  ): PublishableActivity {
    return {
      stagingId:             operational.engine_activity_id,
      productKey:            operational.product_key,
      sourceKey:             operational.source_key,
      title:                 operational.title,
      description:           operational.description,
      occurrences:           original.occurrences, // pass-through, não usado na escrita
      startDate:             operational.start_date,
      endDate:               operational.end_date,
      imageUrl:              operational.imagem_url, // typo intencional — ADR-0015
      sourceUrl:             operational.url,
      phone:                 operational.phone,
      resolvedPublicVenueId: operational.venue_id,
      venueResolutionStatus:  original.venueResolutionStatus, // pass-through, não usado na escrita
      resolvedVenueStagingId: original.resolvedVenueStagingId, // pass-through, não usado na escrita
      promotedActivityId:    original.promotedActivityId,
      stagingUpdatedAt:      original.stagingUpdatedAt,
    };
  }
}
