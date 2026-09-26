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
 * inserir vs arquivar) é tomada aqui, no builder de decisão.
 *
 * Sprint 8.7 — preview(): publish() e preview() partilham exactamente a
 * mesma lógica de decisão (buildDecision) — só a execução diverge, tal como
 * em VenuePublisher. Garante que o preview nunca diverge do comportamento
 * real.
 *
 * Arquivação manual (archiveActivity()): capacidade explícita, separada do
 * fluxo de decisão de publish()/preview() — ver nota completa mais abaixo.
 *
 * CORRECÇÃO ESTRUTURAL (Level 3, 2026-09-23) — Stable Source Activity
 * Identity. Antes desta mudança, o código distinguia "unpublished" (via
 * findUnpublished(), promoted_activity_id IS NULL NESTA linha de staging)
 * de "dirty" (findDirty(), promoted_activity_id IS NOT NULL NESTA linha) —
 * dois caminhos de decisão separados (buildInsertDecision/
 * buildDirtyDecision). Isto estava estruturalmente errado: raw_activity_items
 * é append-only (ver investigação de identidade, 2026-09-21/22) — a MESMA
 * activity real, recolhida de novo numa execução posterior, gera sempre uma
 * linha de staging NOVA, com promoted_activity_id sempre NULL, mesmo que a
 * mesma activity já tenha sido publicada antes via uma linha de staging
 * diferente. findUnpublished() nunca detectava isto, e buildInsertDecision()
 * nunca verificava se já existia uma public.activities para a mesma
 * identidade de fonte antes de decidir 'insert' — resultado: segunda linha
 * pública duplicada a cada recolecta.
 *
 * Os dois caminhos foram fundidos num único buildDecision(), que agora
 * reconcilia SEMPRE pela identidade estável (deriveEngineActivityId,
 * source_key+source_item_id) antes de decidir insert vs update — não mais
 * pela distinção (agora comprovadamente não-fiável) entre findUnpublished()/
 * findDirty(). Ambas as listas continuam a ser lidas e processadas (nenhuma
 * removida), mas através do mesmo builder.
 *
 * Backfill Safety Audit (2026-09-23): 0 de 48 public.activities têm
 * engine_activity_id não-nulo hoje — nenhuma publicação real da Engine
 * ainda aconteceu. Mudança limpa, sem dados a reconciliar.
 *
 * GATE DE DECISÃO HUMANA PARA MATCHED (Level 2, 2026-09-26) — achado real:
 * findUnpublished()/findDirty() (PublishableActivityRepository) filtram por
 * venue_resolution_status IN ('matched','proposed_new') + promoted_activity_id,
 * mas NUNCA verificam se existe uma decisão humana registada em
 * venue_resolution_decisions — apesar de publish.ts documentar essa
 * verificação como parte do "gate oficial" ("venue_resolution_status +
 * decisão humana já registada"). Nunca implementada até agora.
 *
 * Correcção: decisionRepo é um 5º parâmetro OPCIONAL do construtor —
 * ausente, o comportamento é idêntico ao anterior (preserva todos os testes
 * existentes, nenhum dos quais o fornece). Quando fornecido (publish.ts,
 * produção real), buildDecision() exige, para venue_resolution_status =
 * 'matched', uma decisão humana real (action='matched',
 * acceptedCandidateId != null) antes de prosseguir — caso contrário, nova
 * acção 'skip_missing_human_decision', nunca insert/update.
 *
 * proposed_new DELIBERADAMENTE fora deste gate — investigação confirmou que
 * proposed_new é produzido automaticamente pelo ThresholdClassifier (Entity
 * Resolution), sem decisão humana associada na generalidade dos casos
 * actuais, e a Architecture Book v1.1 §5.3 já documenta venue_id=NULL como
 * comportamento esperado e válido para este estado — exigir decisão humana
 * aqui bloquearia esse fluxo inteiro por inferência, não por evidência.
 */

import { PublicationTransformer } from './PublicationTransformer.js';
import { deriveEngineActivityId } from './activityIdentity.js';
import type {
  IPublishableActivityRepository,
  IPublicActivityRepository,
  IPublicationEventRepository,
} from '../repositories/interfaces.js';
import type {
  PublishableActivity,
  OperationalActivityInput,
  PublicActivityId,
  EngineActivityId,
  PublicationRunId,
} from '../types/domain.js';
import type { IVenueResolutionDecisionRepository } from '../../entity-resolution/repositories/interfaces.js';
import type { ActivityStagingId as ERActivityStagingId } from '../../entity-resolution/types/domain.js';

// ── Métricas parciais de activities ──────────────────────────────────────

export interface ActivityPublicationMetrics {
  readonly activitiesPublished: number;
  readonly activitiesUpdated:   number;
  readonly activitiesSkipped:   number;
  readonly activitiesArchived:  number;
  readonly errors:              number;
  readonly durationMs:          number;
}

// ── Decisão por activity (Sprint 8.7) ──────────────────────────────────────

export type ActivityDecision =
  | { readonly action: 'insert';          readonly activity: PublishableActivity; readonly operational: OperationalActivityInput }
  | { readonly action: 'update';          readonly activity: PublishableActivity; readonly operational: OperationalActivityInput; readonly publicActivityId: PublicActivityId }
  | { readonly action: 'skip_not_dirty';  readonly activity: PublishableActivity; readonly publicActivityId: PublicActivityId }
  | { readonly action: 'skip_expired';    readonly activity: PublishableActivity }
  | { readonly action: 'archive_expired'; readonly activity: PublishableActivity; readonly publicActivityId: PublicActivityId }
  // Level 2, 2026-09-26 — matched sem decisão humana registada em
  // venue_resolution_decisions. Nunca insert/update. Ver nota completa no
  // cabeçalho do módulo.
  | { readonly action: 'skip_missing_human_decision'; readonly activity: PublishableActivity }
  | { readonly action: 'error';           readonly activity: PublishableActivity; readonly reason: string };

export class ActivityPublisher {
  constructor(
    private readonly publishableActivityRepo: IPublishableActivityRepository,
    private readonly publicActivityRepo: IPublicActivityRepository,
    private readonly eventRepo: IPublicationEventRepository,
    /** Injectável para testes. Por omissão, relógio real. */
    private readonly clock: () => Date = () => new Date(),
    /**
     * Level 2, 2026-09-26 — opcional. Ausente: gate de decisão humana
     * NUNCA aplicado (comportamento idêntico ao existente antes desta
     * mudança — preserva todos os testes que não o fornecem). Presente
     * (publish.ts, produção real): gate activo para venue_resolution_status
     * = 'matched'.
     */
    private readonly decisionRepo?: IVenueResolutionDecisionRepository,
  ) {}

  /**
   * Publica todas as activities pendentes (novas, dirty) de um produto.
   * Cada activity é processada isoladamente — um erro numa activity não
   * interrompe o processamento das restantes; é contabilizado em `errors`.
   * Não descobre nem arquiva activities por outros motivos automaticamente
   * — ver archiveActivity(). Stale detection por ausência de fonte
   * continua fora de escopo (Level 3, 2026-09-23) — dívida arquitectural
   * separada.
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

    for (const activity of [...unpublished, ...dirtyCandidates]) {
      try {
        const decision = await this.buildDecision(activity, now);
        if (decision.action === 'error') throw new Error(decision.reason);
        await this.executeDecision(decision, runId, productKey);
        if (decision.action === 'insert') activitiesPublished++;
        else if (decision.action === 'update') activitiesUpdated++;
        else if (decision.action === 'archive_expired') activitiesArchived++;
        else activitiesSkipped++; // skip_not_dirty, skip_expired, skip_missing_human_decision
      } catch {
        errors++;
      }
    }

    const durationMs = this.clock().getTime() - startedAt.getTime();

    return { activitiesPublished, activitiesUpdated, activitiesSkipped, activitiesArchived, errors, durationMs };
  }

  /**
   * Sprint 8.7 — calcula as decisões para todas as activities pendentes de
   * um produto, SEM executar nenhuma escrita. Usa exactamente o mesmo
   * builder que publish().
   */
  async preview(productKey: string): Promise<readonly ActivityDecision[]> {
    const now = this.clock();
    const decisions: ActivityDecision[] = [];

    const [unpublished, dirtyCandidates] = await Promise.all([
      this.publishableActivityRepo.findUnpublished(productKey),
      this.publishableActivityRepo.findDirty(productKey),
    ]);

    for (const activity of [...unpublished, ...dirtyCandidates]) {
      try {
        decisions.push(await this.buildDecision(activity, now));
      } catch (err) {
        decisions.push({ action: 'error', activity, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    return decisions;
  }

  /**
   * Arquiva uma activity publicada, por engine_activity_id (identidade
   * estável de fonte — Level 3, 2026-09-23; antes desta correcção, era o
   * staging id bruto). Capacidade explícita — ver nota de arquivação no
   * cabeçalho do módulo. Fora do fluxo de decisão de publish()/preview();
   * não descoberta automaticamente por nenhum dos dois.
   */
  async archiveActivity(
    engineActivityId: EngineActivityId,
    runId: PublicationRunId,
    productKey: string,
  ): Promise<void> {
    const state = await this.publicActivityRepo.findPublicationStateByEngineId(engineActivityId);
    if (state === null) {
      throw new Error(
        `ActivityPublisher.archiveActivity: engine activity ${engineActivityId} sem registo correspondente em public.activities`,
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

  // ── Builder de decisão — puro/só-leitura, partilhado por publish() e preview() ──

  /**
   * Reconciliação por identidade estável (Level 3, 2026-09-23). Substitui
   * os antigos buildInsertDecision()/buildDirtyDecision() — a distinção
   * entre "nunca publicada" e "já publicada" já não pode ser decidida pela
   * própria linha de staging (promoted_activity_id), porque uma recolecta
   * sempre gera uma linha de staging nova, com promoted_activity_id NULL,
   * independentemente de a mesma activity real já estar publicada via
   * outra linha. A verificação correcta é sempre: "já existe
   * public.activities para esta identidade de fonte (source_key +
   * source_item_id)?" — respondida aqui, uma vez, antes de qualquer
   * decisão de insert/update/skip/archive.
   */
  private async buildDecision(activity: PublishableActivity, now: Date): Promise<ActivityDecision> {
    // Level 2, 2026-09-26 — gate de decisão humana para matched. Ver nota
    // completa no cabeçalho do módulo. Aplicado ANTES de qualquer outra
    // lógica de decisão — se falhar, nunca chega a insert/update/archive.
    if (this.decisionRepo && activity.venueResolutionStatus === 'matched') {
      const hasDecision = await this.hasValidHumanDecision(activity.stagingId);
      if (!hasDecision) {
        return { action: 'skip_missing_human_decision', activity };
      }
    }

    const engineActivityId = deriveEngineActivityId(activity.sourceKey, activity.sourceItemId) as EngineActivityId;
    const state = await this.publicActivityRepo.findPublicationStateByEngineId(engineActivityId);

    if (state === null) {
      // CORRECÇÃO (Level 2 review, 2026-09-23) — regression restaurada.
      // Se esta linha de staging já alega estar ligada a um
      // public.activities específico (promotedActivityId preenchido),
      // mas a identidade estável de fonte não tem nenhum registo público
      // correspondente, isto é uma inconsistência de integridade
      // referencial — não uma candidata legítima a nova publicação.
      // Reportada como erro, nunca silenciosamente tratada como insert.
      if (activity.promotedActivityId !== null) {
        return {
          action: 'error',
          activity,
          reason: `activity ${activity.stagingId} tem promotedActivityId=${activity.promotedActivityId} mas nenhum public.activities encontrado para a identidade estável ${engineActivityId}`,
        };
      }
      // Nunca publicada, promotedActivityId null — candidata legítima a insert.
      const operational = PublicationTransformer.transformActivity(activity, now, now);
      if (operational === null) {
        // ADR-0020, regra 5: nunca publicada e sem ocorrência futura → não inserir.
        return { action: 'skip_expired', activity };
      }
      return { action: 'insert', activity, operational };
    }

    // Já existe public.activities para esta identidade — candidata a update/skip/archive.
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

  /**
   * Level 2, 2026-09-26 — verifica se existe uma decisão humana real e
   * válida (action='matched', acceptedCandidateId preenchido) para esta
   * activity, via VenueResolutionDecisionRepository.findLatest() — o
   * mesmo método já usado por EntityResolutionEngine/HumanResolutionService,
   * sem duplicar nenhuma lógica nem criar tabela nova.
   *
   * Cast de StagingActivityId (publishing) para ActivityStagingId
   * (entity-resolution) — dois tipos "branded" distintos que representam o
   * mesmo UUID real (activities_staging.id); fronteira explícita entre os
   * dois módulos, mesmo padrão já usado noutras integrações cross-module
   * desta base de código.
   */
  private async hasValidHumanDecision(stagingId: PublishableActivity['stagingId']): Promise<boolean> {
    if (!this.decisionRepo) return true; // defensivo — buildDecision() já não chama neste caso
    const decision = await this.decisionRepo.findLatest(stagingId as unknown as ERActivityStagingId);
    return decision !== null && decision.action === 'matched' && decision.acceptedCandidateId !== null;
  }

  // ── Execução — só chamada por publish(), nunca por preview() ──────────────

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
        // Level 3, 2026-09-23 — linkToStaging também no caminho de update:
        // a NOVA linha de staging (a que gerou esta reconciliação) ainda
        // não tinha promoted_activity_id preenchido (era isso que a fazia
        // parecer "nunca publicada" antes desta correcção) — sem isto, a
        // mesma linha voltaria a ser candidata a reconciliação na próxima
        // run, indefinidamente.
        await this.publicActivityRepo.linkToStaging(decision.activity.stagingId, decision.publicActivityId);
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
          payload: { reason: 'expired' },
        });
        return;
      }
      case 'skip_not_dirty':
      case 'skip_expired':
      case 'skip_missing_human_decision':
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
      // Level 3, 2026-09-23 — stagingId aqui carrega deliberadamente o
      // engine_activity_id derivado (identidade estável), não o staging id
      // bruto da linha actual — mesmo padrão de reaproveitamento de campo
      // já existente antes desta correcção (o valor mudou de sentido, a
      // reutilização do campo em si não é nova). PublicActivityRepository
      // lê este campo como a identidade a escrever em
      // public.activities.engine_activity_id.
      stagingId:             operational.engine_activity_id as unknown as PublishableActivity['stagingId'],
      productKey:            operational.product_key,
      sourceKey:             operational.source_key,
      sourceItemId:          original.sourceItemId, // pass-through, não usado na escrita
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
