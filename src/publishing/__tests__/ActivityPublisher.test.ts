/**
 * src/publishing/__tests__/ActivityPublisher.test.ts
 * Sprint 8.5/8.7 — testes com mocks. Zero Supabase, zero rede.
 *
 * CORRECÇÃO (Level 3, 2026-09-23) — Stable Source Activity Identity.
 * makeActivity() ganhou sourceItemId (campo novo, obrigatório). Todo o
 * teste que antes distinguia activities pelo stagingId para decidir
 * insert/update via o mock de findPublicationStateByEngineId passa a
 * distingui-las por sourceItemId + deriveEngineActivityId — é essa
 * identidade, não o stagingId, que agora decide o caminho de reconciliação
 * (ver ActivityPublisher.buildDecision()). archiveActivity() passa a
 * receber EngineActivityId, não StagingActivityId.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActivityPublisher } from '../services/ActivityPublisher.js';
import { deriveEngineActivityId } from '../services/activityIdentity.js';
import type {
  IPublishableActivityRepository,
  IPublicActivityRepository,
  IPublicationEventRepository,
} from '../repositories/interfaces.js';
import type {
  PublishableActivity,
  ActivityOccurrence,
  PublicActivityId,
  PublicVenueId,
  StagingActivityId,
  StagingVenueId,
  EngineActivityId,
  PublicationRunId,
  PublicationEventId,
  PublicActivityPublicationState,
} from '../types/domain.js';

// ── Fixtures ─────────────────────────────────────────────────────────────

const RUN_ID       = 'run-001'   as PublicationRunId;
const PRODUCT_KEY  = 'vivere-60-mais';
const NOW          = new Date('2026-07-09T12:00:00.000Z');

const FUTURE_OCCURRENCE: ActivityOccurrence = {
  date: '2026-08-01', time: '09:00', endDate: null, endTime: null,
};
const PAST_OCCURRENCE: ActivityOccurrence = {
  date: '2026-01-01', time: '09:00', endDate: null, endTime: null,
};

function makeActivity(overrides: Partial<PublishableActivity> = {}): PublishableActivity {
  return {
    stagingId:             'sa-001' as StagingActivityId,
    productKey:            PRODUCT_KEY,
    sourceKey:             'prefeitura_cabo_frio',
    // Level 3, 2026-09-23 — identidade estável por omissão; testes que
    // precisam de identidades DISTINTAS (ex: "métricas") sobrepõem isto
    // explicitamente, e não apenas stagingId, já que é sourceItemId (não
    // stagingId) que agora decide insert vs update.
    sourceItemId:          '146007_0',
    title:                 'Yoga no Forte',
    description:           'Aula de yoga na praia',
    occurrences:           [FUTURE_OCCURRENCE],
    startDate:             null,
    endDate:               null,
    imageUrl:              null,
    sourceUrl:             'https://cabofrio.rj.gov.br/yoga',
    phone:                 null,
    resolvedPublicVenueId: 'venue-001' as PublicVenueId,
    venueResolutionStatus:  'matched',
    resolvedVenueStagingId: 'sv-001' as StagingVenueId,
    promotedActivityId:    null,
    stagingUpdatedAt:      new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepos(overrides: {
  findUnpublished?:  readonly PublishableActivity[];
  findDirty?:        readonly PublishableActivity[];
  insertImpl?:       ReturnType<typeof vi.fn>;
  updateImpl?:       ReturnType<typeof vi.fn>;
  archiveImpl?:      ReturnType<typeof vi.fn>;
  publicationState?: ReturnType<typeof vi.fn>;
} = {}) {
  const publishableActivity: IPublishableActivityRepository = {
    findUnpublished: vi.fn().mockResolvedValue(overrides.findUnpublished ?? []),
    findDirty:       vi.fn().mockResolvedValue(overrides.findDirty ?? []),
    describeFunnel:  vi.fn().mockResolvedValue({ total: 0, byVenueResolutionStatus: {}, alreadyPublished: 0 }),
  };

  const publicActivity: IPublicActivityRepository = {
    insert:                         (overrides.insertImpl       ?? vi.fn().mockResolvedValue('activity-new-001' as PublicActivityId)) as IPublicActivityRepository['insert'],
    update:                         (overrides.updateImpl       ?? vi.fn().mockResolvedValue(undefined)) as IPublicActivityRepository['update'],
    archive:                        (overrides.archiveImpl      ?? vi.fn().mockResolvedValue(undefined)) as IPublicActivityRepository['archive'],
    linkToStaging:                  vi.fn().mockResolvedValue(undefined),
    findByEngineId:                 vi.fn().mockResolvedValue(null),
    // Por omissão: null — qualquer activity é tratada como "nunca
    // publicada sob esta identidade" (caminho insert), salvo override.
    findPublicationStateByEngineId: (overrides.publicationState ?? vi.fn().mockResolvedValue(null)) as IPublicActivityRepository['findPublicationStateByEngineId'],
  };

  const eventRepo: IPublicationEventRepository = {
    record: vi.fn().mockResolvedValue('evt-001' as PublicationEventId),
  };

  return { publishableActivity, publicActivity, eventRepo };
}

function makeState(publicActivityId: PublicActivityId, lastPublishedAt: Date): PublicActivityPublicationState {
  return { publicActivityId, lastPublishedAt, engineStatus: 'active' };
}

// ── Publica activity nova ────────────────────────────────────────────────

describe('ActivityPublisher — activity nova', () => {
  it('publica activity nova: insert + linkToStaging + evento ActivityPublished + métricas', async () => {
    const activity = makeActivity();
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.insert).toHaveBeenCalledTimes(1);
    expect(publicActivity.linkToStaging).toHaveBeenCalledWith(activity.stagingId, 'activity-new-001');
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ActivityPublished', entityType: 'activity', entityId: 'activity-new-001', runId: RUN_ID }),
    );
    expect(metrics.activitiesPublished).toBe(1);
    expect(metrics.activitiesUpdated).toBe(0);
    expect(metrics.activitiesSkipped).toBe(0);
    expect(metrics.errors).toBe(0);
  });

  it('resolve venue_id a partir de resolvedPublicVenueId (já calculado por PublishableActivityRepository)', async () => {
    const activity = makeActivity({ resolvedPublicVenueId: 'venue-xyz' as PublicVenueId });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    await publisher.publish(PRODUCT_KEY, RUN_ID);

    const [adapted] = (publicActivity.insert as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(adapted.resolvedPublicVenueId).toBe('venue-xyz');
  });

  it('permite venue_id = NULL para activity proposed_new', async () => {
    const activity = makeActivity({ resolvedPublicVenueId: null, venueResolutionStatus: 'proposed_new', resolvedVenueStagingId: null });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    await publisher.publish(PRODUCT_KEY, RUN_ID);

    const [adapted] = (publicActivity.insert as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(adapted.resolvedPublicVenueId).toBeNull();
    expect(publicActivity.insert).toHaveBeenCalledTimes(1); // não bloqueia a publicação
  });

  it('o payload de insert usa imagem_url (typo ADR-0015) via PublicationTransformer', async () => {
    const activity = makeActivity({ imageUrl: 'https://x.com/yoga.jpg' });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    await publisher.publish(PRODUCT_KEY, RUN_ID);

    const [adapted] = (publicActivity.insert as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(adapted.imageUrl).toBe('https://x.com/yoga.jpg'); // forma de domínio — typo só na escrita ao banco
  });
});

// ── ADR-0020 — múltiplas ocorrências e expiração ─────────────────────────

describe('ActivityPublisher — ADR-0020 (ocorrências e expiração)', () => {
  it('selecciona a próxima ocorrência futura ao publicar pela primeira vez', async () => {
    const activity = makeActivity({
      occurrences: [PAST_OCCURRENCE, FUTURE_OCCURRENCE],
    });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    await publisher.publish(PRODUCT_KEY, RUN_ID);

    const [adapted] = (publicActivity.insert as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(adapted.startDate).toEqual(new Date('2026-08-01T09:00:00.000Z'));
  });

  it('activity nova sem nenhuma ocorrência futura NÃO é inserida — skip silencioso', async () => {
    const activity = makeActivity({ occurrences: [PAST_OCCURRENCE] });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.insert).not.toHaveBeenCalled();
    expect(eventRepo.record).not.toHaveBeenCalled(); // zero writes → zero eventos
    expect(metrics.activitiesSkipped).toBe(1);
    expect(metrics.activitiesPublished).toBe(0);
  });

  it('activity dirty e já publicada, agora sem ocorrência futura, é arquivada (não actualizada)', async () => {
    const publicId = 'activity-expiring-001' as PublicActivityId;
    const activity = makeActivity({
      stagingId:           'sa-expiring' as StagingActivityId,
      sourceItemId:        'expiring-001',
      promotedActivityId:  publicId,
      occurrences:         [PAST_OCCURRENCE], // já não tem ocorrência futura
      stagingUpdatedAt:    new Date('2026-07-08T00:00:00.000Z'), // dirty (mais recente que last_published_at)
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findDirty: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.update).not.toHaveBeenCalled();
    expect(publicActivity.archive).toHaveBeenCalledWith(publicId);
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ActivityArchived',
        entityId:  publicId,
        payload:   expect.objectContaining({ reason: 'expired' }),
      }),
    );
    expect(metrics.activitiesArchived).toBe(1);
    expect(metrics.activitiesUpdated).toBe(0);
  });

  it('activity dirty, já publicada, ainda com ocorrência futura, actualiza normalmente (não confunde com expirada)', async () => {
    const publicId = 'activity-still-valid-001' as PublicActivityId;
    const activity = makeActivity({
      stagingId:           'sa-still-valid' as StagingActivityId,
      sourceItemId:        'still-valid-001',
      promotedActivityId:  publicId,
      occurrences:         [FUTURE_OCCURRENCE],
      stagingUpdatedAt:    new Date('2026-07-08T00:00:00.000Z'),
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findDirty: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.update).toHaveBeenCalledWith(publicId, expect.anything());
    expect(publicActivity.archive).not.toHaveBeenCalled();
    expect(metrics.activitiesUpdated).toBe(1);
    expect(metrics.activitiesArchived).toBe(0);
  });
});

// ── Dirty check real ──────────────────────────────────────────────────────

describe('ActivityPublisher — dirty check', () => {
  it('actualiza activity existente quando dirty (staging.updated_at > public.last_published_at)', async () => {
    const publicId = 'activity-existing-001' as PublicActivityId;
    const activity = makeActivity({
      stagingId:           'sa-dirty-001' as StagingActivityId,
      sourceItemId:        'dirty-001',
      promotedActivityId:  publicId,
      stagingUpdatedAt:    new Date('2026-07-05T00:00:00.000Z'),
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findDirty: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    // Level 3, 2026-09-23 — o lookup é feito pela identidade estável
    // derivada (source_key + source_item_id), não mais por activity.stagingId.
    const expectedEngineId = deriveEngineActivityId(activity.sourceKey, activity.sourceItemId);
    expect(publicActivity.findPublicationStateByEngineId).toHaveBeenCalledWith(expectedEngineId);
    expect(publicActivity.update).toHaveBeenCalledWith(publicId, expect.anything());
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ActivityUpdated', entityId: publicId }),
    );
    expect(metrics.activitiesUpdated).toBe(1);
    expect(metrics.activitiesSkipped).toBe(0);
  });

  it('ignora activity não dirty (staging.updated_at <= public.last_published_at) — zero writes, zero eventos', async () => {
    const publicId = 'activity-existing-002' as PublicActivityId;
    const activity = makeActivity({
      stagingId:          'sa-dirty-002' as StagingActivityId,
      sourceItemId:       'dirty-002',
      promotedActivityId: publicId,
      stagingUpdatedAt:   new Date('2026-07-01T00:00:00.000Z'),
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findDirty: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.update).not.toHaveBeenCalled();
    expect(eventRepo.record).not.toHaveBeenCalled();
    expect(metrics.activitiesSkipped).toBe(1);
    expect(metrics.activitiesUpdated).toBe(0);
  });

  it('promotedActivityId preenchido mas sem registo público correspondente (identidade estável) é erro — não insert (Level 2 review, 2026-09-23, restaura garantia de integridade)', async () => {
    const activity = makeActivity({
      sourceItemId:       'orphan-promoted-001',
      promotedActivityId: 'activity-ghost-001' as PublicActivityId, // alega já promovida
      stagingUpdatedAt:   new Date(),
    });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({
      findDirty: [activity],
      publicationState: vi.fn().mockResolvedValue(null), // mas nenhum registo público real
    });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(metrics.errors).toBe(1);
    expect(metrics.activitiesPublished).toBe(0);
    expect(metrics.activitiesUpdated).toBe(0);
    expect(publicActivity.insert).not.toHaveBeenCalled();
    expect(publicActivity.update).not.toHaveBeenCalled();
  });

  it('nova observação de staging (promotedActivityId null) reconcilia com public.activities já existente sob a mesma identidade de fonte — UPDATE, não INSERT duplicado (Level 2 review, 2026-09-23, caso central da Stable Source Activity Identity)', async () => {
    const publicId = 'activity-reconciled-001' as PublicActivityId;
    // Modela uma NOVA linha de staging (esta linha específica nunca foi
    // promovida — promotedActivityId null), mas cuja identidade de fonte
    // (sourceKey+sourceItemId) já tem uma public.activities publicada via
    // uma linha de staging anterior e diferente — exactamente o cenário
    // "Run 1 → staging A → publicado; Run 2 → staging B → mesma fonte"
    // que motivou toda esta correcção.
    const activity = makeActivity({
      stagingId:           'sa-recollected' as StagingActivityId,
      sourceItemId:        'reconcile-001',
      promotedActivityId:  null, // esta linha nunca foi promovida ela própria
      stagingUpdatedAt:    new Date('2026-07-08T00:00:00.000Z'), // mais recente que o último publish
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.insert).not.toHaveBeenCalled(); // NÃO duplica
    expect(publicActivity.update).toHaveBeenCalledWith(publicId, expect.anything());
    expect(publicActivity.linkToStaging).toHaveBeenCalledWith(activity.stagingId, publicId);
    expect(metrics.activitiesUpdated).toBe(1);
    expect(metrics.activitiesPublished).toBe(0);
    expect(metrics.errors).toBe(0);
  });
});

// ── Arquivação (capacidade explícita) ────────────────────────────────────

describe('ActivityPublisher.archiveActivity', () => {
  it('arquiva activity + evento ActivityArchived com reason=manual', async () => {
    const engineId  = 'ea-archive-001' as EngineActivityId;
    const publicId  = 'activity-archive-001' as PublicActivityId;
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    await publisher.archiveActivity(engineId, RUN_ID, PRODUCT_KEY);

    expect(publicActivity.archive).toHaveBeenCalledWith(publicId);
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ActivityArchived',
        entityId:  publicId,
        payload:   expect.objectContaining({ reason: 'manual' }),
      }),
    );
  });

  it('lança erro quando a activity não tem registo correspondente em public.activities', async () => {
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({
      publicationState: vi.fn().mockResolvedValue(null),
    });
    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);

    await expect(publisher.archiveActivity('ea-inexistente' as EngineActivityId, RUN_ID, PRODUCT_KEY))
      .rejects.toThrow();
    expect(publicActivity.archive).not.toHaveBeenCalled();
  });

  it('publish() não descobre activities a arquivar por outros motivos automaticamente', async () => {
    const activity = makeActivity();
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.archive).not.toHaveBeenCalled();
    expect(metrics.activitiesArchived).toBe(0);
  });
});

// ── Campos preservados (ADR-0018) ────────────────────────────────────────

describe('ActivityPublisher — campos preservados', () => {
  it('nunca inclui schedule, price, is_free, is_sponsored, interested_count no payload adaptado', async () => {
    const activity = makeActivity();
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    await publisher.publish(PRODUCT_KEY, RUN_ID);

    const [adapted] = (publicActivity.insert as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const keys = Object.keys(adapted);

    for (const forbidden of ['schedule', 'price', 'is_free', 'is_sponsored', 'category', 'interested_count', 'recurrence_type']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

// ── Métricas ──────────────────────────────────────────────────────────────

describe('ActivityPublisher — métricas', () => {
  it('agrega correctamente publicadas, actualizadas e ignoradas numa única run', async () => {
    // Level 3, 2026-09-23 — três identidades de fonte DISTINTAS
    // (sourceItemId diferente cada), porque é isso, não stagingId, que
    // agora decide insert/update via a identidade estável derivada.
    const newActivity = makeActivity({
      stagingId:    'sa-new' as StagingActivityId,
      sourceItemId: 'new-001',
    });

    const dirtyActivity = makeActivity({
      stagingId:           'sa-dirty' as StagingActivityId,
      sourceItemId:        'dirty-metrics-001',
      promotedActivityId:  'activity-dirty' as PublicActivityId,
      stagingUpdatedAt:    new Date('2026-07-08T00:00:00.000Z'),
    });
    const cleanActivity = makeActivity({
      stagingId:           'sa-clean' as StagingActivityId,
      sourceItemId:        'clean-metrics-001',
      promotedActivityId:  'activity-clean' as PublicActivityId,
      stagingUpdatedAt:    new Date('2026-07-01T00:00:00.000Z'),
    });

    const dirtyEngineId = deriveEngineActivityId(dirtyActivity.sourceKey, dirtyActivity.sourceItemId);
    const cleanEngineId = deriveEngineActivityId(cleanActivity.sourceKey, cleanActivity.sourceItemId);

    const publicationState = vi.fn().mockImplementation((engineActivityId: string) => {
      if (engineActivityId === dirtyEngineId) {
        return Promise.resolve(makeState('activity-dirty' as PublicActivityId, new Date('2026-07-01T00:00:00.000Z')));
      }
      if (engineActivityId === cleanEngineId) {
        return Promise.resolve(makeState('activity-clean' as PublicActivityId, new Date('2026-07-01T00:00:00.000Z')));
      }
      return Promise.resolve(null);
    });

    const { publishableActivity, publicActivity, eventRepo } = makeRepos({
      findUnpublished: [newActivity],
      findDirty:       [dirtyActivity, cleanActivity],
      publicationState,
    });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(metrics).toEqual({
      activitiesPublished: 1,
      activitiesUpdated:   1,
      activitiesSkipped:   1,
      activitiesArchived:  0,
      errors:              0,
      durationMs:          0,
    });
  });

  it('um erro numa activity não interrompe o processamento das restantes', async () => {
    const activityOk   = makeActivity({ stagingId: 'sa-ok' as StagingActivityId, sourceItemId: 'ok-001' });
    const activityFail = makeActivity({ stagingId: 'sa-fail' as StagingActivityId, sourceItemId: 'fail-001' });

    const insertImpl = vi.fn()
      .mockRejectedValueOnce(new Error('falha simulada de escrita'))
      .mockResolvedValueOnce('activity-ok' as PublicActivityId);

    const { publishableActivity, publicActivity, eventRepo } = makeRepos({
      findUnpublished: [activityFail, activityOk],
      insertImpl,
    });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(metrics.errors).toBe(1);
    expect(metrics.activitiesPublished).toBe(1);
  });
});

// ── Anti-Corruption Layer (adaptador) ────────────────────────────────────

describe('ActivityPublisher.adaptToPublishableActivity', () => {
  it('função pura: reconstrói PublishableActivity a partir do OperationalActivityInput + original', () => {
    const original = makeActivity({ promotedActivityId: 'activity-x' as PublicActivityId });
    const operational = {
      title:              'Título Transformado',
      description:        'Descrição',
      start_date:         new Date('2026-08-01T09:00:00.000Z'),
      end_date:            null,
      imagem_url:          'https://x.com/img.jpg',
      url:                 'https://x.com',
      phone:               '123',
      venue_id:            'venue-y' as PublicVenueId,
      // Level 3, 2026-09-23 — engine_activity_id é EngineActivityId, não
      // StagingActivityId; cast explícito aqui só para construir a
      // fixture de teste (mesmo padrão usado em ActivityPublisher.ts,
      // adaptToPublishableActivity).
      engine_activity_id:  original.stagingId as unknown as EngineActivityId,
      source_key:          original.sourceKey,
      product_key:         original.productKey,
      engine_status:       'active' as const,
      last_published_at:   NOW,
    };

    const adapted = ActivityPublisher.adaptToPublishableActivity(operational, original);

    expect(adapted.title).toBe('Título Transformado');
    expect(adapted.imageUrl).toBe('https://x.com/img.jpg');
    expect(adapted.resolvedPublicVenueId).toBe('venue-y');
    expect(adapted.stagingId).toBe(original.stagingId);
    expect(adapted.sourceItemId).toBe(original.sourceItemId); // pass-through
    expect(adapted.promotedActivityId).toBe('activity-x');
    expect(adapted.stagingUpdatedAt).toBe(original.stagingUpdatedAt);
    expect(adapted.occurrences).toBe(original.occurrences); // pass-through
  });
});

// ── preview() — Sprint 8.7 ────────────────────────────────────────────────

describe('ActivityPublisher.preview', () => {
  it('nunca escreve: zero insert/update/archive/linkToStaging/eventos', async () => {
    const newActivity = makeActivity({ stagingId: 'sa-new' as StagingActivityId, sourceItemId: 'preview-new-001' });
    const dirtyActivity = makeActivity({
      stagingId:           'sa-dirty' as StagingActivityId,
      sourceItemId:        'preview-dirty-001',
      promotedActivityId:  'activity-dirty' as PublicActivityId,
      stagingUpdatedAt:    new Date('2026-07-08T00:00:00.000Z'),
    });
    const publicationState = vi.fn().mockResolvedValue(makeState('activity-dirty' as PublicActivityId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({
      findUnpublished: [newActivity],
      findDirty:       [dirtyActivity],
      publicationState,
    });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    await publisher.preview(PRODUCT_KEY);

    expect(publicActivity.insert).not.toHaveBeenCalled();
    expect(publicActivity.update).not.toHaveBeenCalled();
    expect(publicActivity.archive).not.toHaveBeenCalled();
    expect(publicActivity.linkToStaging).not.toHaveBeenCalled();
    expect(eventRepo.record).not.toHaveBeenCalled();
  });

  it('classifica activity nova com ocorrência futura como insert', async () => {
    const activity = makeActivity({ occurrences: [FUTURE_OCCURRENCE] });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]!.action).toBe('insert');
    if (decisions[0]!.action === 'insert') {
      expect(decisions[0].operational.start_date).toEqual(new Date('2026-08-01T09:00:00.000Z'));
    }
  });

  it('classifica activity nova sem ocorrência futura como skip_expired', async () => {
    const activity = makeActivity({ occurrences: [PAST_OCCURRENCE] });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]!.action).toBe('skip_expired');
  });

  it('classifica activity dirty ainda válida como update', async () => {
    const publicId = 'activity-x' as PublicActivityId;
    const activity = makeActivity({
      sourceItemId:        'preview-valid-001',
      promotedActivityId: publicId,
      occurrences:         [FUTURE_OCCURRENCE],
      stagingUpdatedAt:    new Date('2026-07-08T00:00:00.000Z'),
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findDirty: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]).toMatchObject({ action: 'update', publicActivityId: publicId });
  });

  it('classifica activity dirty agora expirada como archive_expired', async () => {
    const publicId = 'activity-y' as PublicActivityId;
    const activity = makeActivity({
      sourceItemId:        'preview-expired-001',
      promotedActivityId: publicId,
      occurrences:         [PAST_OCCURRENCE],
      stagingUpdatedAt:    new Date('2026-07-08T00:00:00.000Z'),
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findDirty: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]).toMatchObject({ action: 'archive_expired', publicActivityId: publicId });
  });

  it('classifica activity não-dirty como skip_not_dirty', async () => {
    const publicId = 'activity-z' as PublicActivityId;
    const activity = makeActivity({ sourceItemId: 'preview-clean-001', promotedActivityId: publicId, stagingUpdatedAt: new Date('2026-07-01T00:00:00.000Z') });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findDirty: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]).toMatchObject({ action: 'skip_not_dirty', publicActivityId: publicId });
  });

  it('resolvedPublicVenueId (venue resolvido ou NULL) está sempre disponível via decision.activity, mesmo em skip_expired', async () => {
    const withVenue    = makeActivity({ stagingId: 'sa-v1' as StagingActivityId, sourceItemId: 'preview-v1', resolvedPublicVenueId: 'venue-1' as PublicVenueId, occurrences: [PAST_OCCURRENCE] });
    const withoutVenue = makeActivity({ stagingId: 'sa-v2' as StagingActivityId, sourceItemId: 'preview-v2', resolvedPublicVenueId: null, venueResolutionStatus: 'proposed_new', resolvedVenueStagingId: null, occurrences: [PAST_OCCURRENCE] });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [withVenue, withoutVenue] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]!.activity.resolvedPublicVenueId).toBe('venue-1');
    expect(decisions[1]!.activity.resolvedPublicVenueId).toBeNull();
  });

  it('classifica promotedActivityId órfão como error, sem nenhuma escrita (Level 2 review, 2026-09-23)', async () => {
    const activity = makeActivity({
      sourceItemId:       'preview-orphan-001',
      promotedActivityId: 'activity-ghost-002' as PublicActivityId,
      stagingUpdatedAt:   new Date(),
    });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({
      findDirty: [activity],
      publicationState: vi.fn().mockResolvedValue(null),
    });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]!.action).toBe('error');
    expect(publicActivity.insert).not.toHaveBeenCalled();
    expect(publicActivity.update).not.toHaveBeenCalled();
    expect(publicActivity.archive).not.toHaveBeenCalled();
    expect(publicActivity.linkToStaging).not.toHaveBeenCalled();
    expect(eventRepo.record).not.toHaveBeenCalled();
  });

  it('publish() e preview() produzem a mesma classificação para o mesmo estado (sem divergência)', async () => {
    const dirtyActivity = makeActivity({
      stagingId:           'sa-consistency' as StagingActivityId,
      sourceItemId:        'consistency-001',
      promotedActivityId:  'activity-consistency' as PublicActivityId,
      occurrences:         [PAST_OCCURRENCE],
      stagingUpdatedAt:    new Date('2026-07-08T00:00:00.000Z'),
    });
    const publicationState = vi.fn().mockResolvedValue(makeState('activity-consistency' as PublicActivityId, new Date('2026-07-01T00:00:00.000Z')));

    const previewRepos = makeRepos({ findDirty: [dirtyActivity], publicationState });
    const publishRepos = makeRepos({ findDirty: [dirtyActivity], publicationState });

    const previewPublisher = new ActivityPublisher(previewRepos.publishableActivity, previewRepos.publicActivity, previewRepos.eventRepo, () => NOW);
    const publishPublisher = new ActivityPublisher(publishRepos.publishableActivity, publishRepos.publicActivity, publishRepos.eventRepo, () => NOW);

    const decisions = await previewPublisher.preview(PRODUCT_KEY);
    await publishPublisher.publish(PRODUCT_KEY, RUN_ID);

    expect(decisions[0]!.action).toBe('archive_expired');
    expect(publishRepos.publicActivity.archive).toHaveBeenCalledTimes(1);
  });
});
