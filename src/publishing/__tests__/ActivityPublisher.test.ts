/**
 * src/publishing/__tests__/ActivityPublisher.test.ts
 * Sprint 8.5/8.7 — testes com mocks. Zero Supabase, zero rede.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActivityPublisher } from '../services/ActivityPublisher.js';
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
  PublicationRunId,
  PublicationEventId,
  PublicActivityPublicationState,
} from '../types/domain.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

// ── Publica activity nova ──────────────────────────────────────────────────────

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

// ── ADR-0020 — múltiplas ocorrências e expiração ──────────────────────────────

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

// ── Dirty check real ──────────────────────────────────────────────────────────

describe('ActivityPublisher — dirty check', () => {
  it('actualiza activity existente quando dirty (staging.updated_at > public.last_published_at)', async () => {
    const publicId = 'activity-existing-001' as PublicActivityId;
    const activity = makeActivity({
      stagingId:           'sa-dirty-001' as StagingActivityId,
      promotedActivityId:  publicId,
      stagingUpdatedAt:    new Date('2026-07-05T00:00:00.000Z'),
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findDirty: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.findPublicationStateByEngineId).toHaveBeenCalledWith(activity.stagingId);
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

  it('erro no dirty check (staging activity sem registo em public.activities) é contabilizado em errors', async () => {
    const activity = makeActivity({ stagingUpdatedAt: new Date() });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({
      findDirty: [activity],
      publicationState: vi.fn().mockResolvedValue(null),
    });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(metrics.errors).toBe(1);
    expect(publicActivity.update).not.toHaveBeenCalled();
  });
});

// ── Arquivação (capacidade explícita) ─────────────────────────────────────────

describe('ActivityPublisher.archiveActivity', () => {
  it('arquiva activity + evento ActivityArchived com reason=manual', async () => {
    const engineId  = 'sa-archive-001' as StagingActivityId;
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

    await expect(publisher.archiveActivity('sa-inexistente' as StagingActivityId, RUN_ID, PRODUCT_KEY))
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

// ── Campos preservados (ADR-0018) ─────────────────────────────────────────────

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

// ── Métricas ──────────────────────────────────────────────────────────────────

describe('ActivityPublisher — métricas', () => {
  it('agrega correctamente publicadas, actualizadas e ignoradas numa única run', async () => {
    const newActivity = makeActivity({ stagingId: 'sa-new' as StagingActivityId });

    const dirtyActivity = makeActivity({
      stagingId:           'sa-dirty' as StagingActivityId,
      promotedActivityId:  'activity-dirty' as PublicActivityId,
      stagingUpdatedAt:    new Date('2026-07-08T00:00:00.000Z'),
    });
    const cleanActivity = makeActivity({
      stagingId:           'sa-clean' as StagingActivityId,
      promotedActivityId:  'activity-clean' as PublicActivityId,
      stagingUpdatedAt:    new Date('2026-07-01T00:00:00.000Z'),
    });

    const publicationState = vi.fn().mockImplementation((engineActivityId: StagingActivityId) => {
      if (engineActivityId === 'sa-dirty') {
        return Promise.resolve(makeState('activity-dirty' as PublicActivityId, new Date('2026-07-01T00:00:00.000Z')));
      }
      if (engineActivityId === 'sa-clean') {
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
    const activityOk   = makeActivity({ stagingId: 'sa-ok' as StagingActivityId });
    const activityFail = makeActivity({ stagingId: 'sa-fail' as StagingActivityId });

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

// ── Anti-Corruption Layer (adaptador) ─────────────────────────────────────────

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
      engine_activity_id:  original.stagingId,
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
    expect(adapted.promotedActivityId).toBe('activity-x');
    expect(adapted.stagingUpdatedAt).toBe(original.stagingUpdatedAt);
    expect(adapted.occurrences).toBe(original.occurrences); // pass-through
  });
});

// ── preview() — Sprint 8.7 ────────────────────────────────────────────────────

describe('ActivityPublisher.preview', () => {
  it('nunca escreve: zero insert/update/archive/linkToStaging/eventos', async () => {
    const newActivity = makeActivity({ stagingId: 'sa-new' as StagingActivityId });
    const dirtyActivity = makeActivity({
      stagingId:           'sa-dirty' as StagingActivityId,
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
    const activity = makeActivity({ promotedActivityId: publicId, stagingUpdatedAt: new Date('2026-07-01T00:00:00.000Z') });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findDirty: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]).toMatchObject({ action: 'skip_not_dirty', publicActivityId: publicId });
  });

  it('resolvedPublicVenueId (venue resolvido ou NULL) está sempre disponível via decision.activity, mesmo em skip_expired', async () => {
    const withVenue    = makeActivity({ stagingId: 'sa-v1' as StagingActivityId, resolvedPublicVenueId: 'venue-1' as PublicVenueId, occurrences: [PAST_OCCURRENCE] });
    const withoutVenue = makeActivity({ stagingId: 'sa-v2' as StagingActivityId, resolvedPublicVenueId: null, venueResolutionStatus: 'proposed_new', resolvedVenueStagingId: null, occurrences: [PAST_OCCURRENCE] });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [withVenue, withoutVenue] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]!.activity.resolvedPublicVenueId).toBe('venue-1');
    expect(decisions[1]!.activity.resolvedPublicVenueId).toBeNull();
  });

  it('publish() e preview() produzem a mesma classificação para o mesmo estado (sem divergência)', async () => {
    const dirtyActivity = makeActivity({
      stagingId:           'sa-consistency' as StagingActivityId,
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
