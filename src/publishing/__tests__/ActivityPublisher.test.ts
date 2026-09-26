/**
 * src/publishing/__tests__/ActivityPublisher.test.ts
 * Sprint 8.5/8.7 ÔÇö testes com mocks. Zero Supabase, zero rede.
 *
 * CORREC├ç├âO (Level 3, 2026-09-23) ÔÇö Stable Source Activity Identity.
 * makeActivity() ganhou sourceItemId (campo novo, obrigat├│rio). Todo o
 * teste que antes distinguia activities pelo stagingId para decidir
 * insert/update via o mock de findPublicationStateByEngineId passa a
 * distingui-las por sourceItemId + deriveEngineActivityId ÔÇö ├® essa
 * identidade, n├úo o stagingId, que agora decide o caminho de reconcilia├º├úo
 * (ver ActivityPublisher.buildDecision()). archiveActivity() passa a
 * receber EngineActivityId, n├úo StagingActivityId.
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
// Level 2, 2026-09-26 — gate de decisão humana para matched.
import type { IVenueResolutionDecisionRepository } from '../../entity-resolution/repositories/interfaces.js';
import type { ActivityStagingId as ERActivityStagingId, CandidateId, ResolutionDecision } from '../../entity-resolution/types/domain.js';

// ÔöÇÔöÇ Fixtures ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

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
    // Level 3, 2026-09-23 ÔÇö identidade est├ível por omiss├úo; testes que
    // precisam de identidades DISTINTAS (ex: "m├®tricas") sobrep├Áem isto
    // explicitamente, e n├úo apenas stagingId, j├í que ├® sourceItemId (n├úo
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
    // Por omiss├úo: null ÔÇö qualquer activity ├® tratada como "nunca
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

// ÔöÇÔöÇ Publica activity nova ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

describe('ActivityPublisher ÔÇö activity nova', () => {
  it('publica activity nova: insert + linkToStaging + evento ActivityPublished + m├®tricas', async () => {
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

  it('resolve venue_id a partir de resolvedPublicVenueId (j├í calculado por PublishableActivityRepository)', async () => {
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
    expect(publicActivity.insert).toHaveBeenCalledTimes(1); // n├úo bloqueia a publica├º├úo
  });

  it('o payload de insert usa imagem_url (typo ADR-0015) via PublicationTransformer', async () => {
    const activity = makeActivity({ imageUrl: 'https://x.com/yoga.jpg' });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    await publisher.publish(PRODUCT_KEY, RUN_ID);

    const [adapted] = (publicActivity.insert as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(adapted.imageUrl).toBe('https://x.com/yoga.jpg'); // forma de dom├¡nio ÔÇö typo s├│ na escrita ao banco
  });
});

// ÔöÇÔöÇ ADR-0020 ÔÇö m├║ltiplas ocorr├¬ncias e expira├º├úo ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

describe('ActivityPublisher ÔÇö ADR-0020 (ocorr├¬ncias e expira├º├úo)', () => {
  it('selecciona a pr├│xima ocorr├¬ncia futura ao publicar pela primeira vez', async () => {
    const activity = makeActivity({
      occurrences: [PAST_OCCURRENCE, FUTURE_OCCURRENCE],
    });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    await publisher.publish(PRODUCT_KEY, RUN_ID);

    const [adapted] = (publicActivity.insert as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(adapted.startDate).toEqual(new Date('2026-08-01T09:00:00.000Z'));
  });

  it('activity nova sem nenhuma ocorr├¬ncia futura N├âO ├® inserida ÔÇö skip silencioso', async () => {
    const activity = makeActivity({ occurrences: [PAST_OCCURRENCE] });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.insert).not.toHaveBeenCalled();
    expect(eventRepo.record).not.toHaveBeenCalled(); // zero writes ÔåÆ zero eventos
    expect(metrics.activitiesSkipped).toBe(1);
    expect(metrics.activitiesPublished).toBe(0);
  });

  it('activity dirty e j├í publicada, agora sem ocorr├¬ncia futura, ├® arquivada (n├úo actualizada)', async () => {
    const publicId = 'activity-expiring-001' as PublicActivityId;
    const activity = makeActivity({
      stagingId:           'sa-expiring' as StagingActivityId,
      sourceItemId:        'expiring-001',
      promotedActivityId:  publicId,
      occurrences:         [PAST_OCCURRENCE], // j├í n├úo tem ocorr├¬ncia futura
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

  it('activity dirty, j├í publicada, ainda com ocorr├¬ncia futura, actualiza normalmente (n├úo confunde com expirada)', async () => {
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

// ÔöÇÔöÇ Dirty check real ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

describe('ActivityPublisher ÔÇö dirty check', () => {
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

    // Level 3, 2026-09-23 ÔÇö o lookup ├® feito pela identidade est├ível
    // derivada (source_key + source_item_id), n├úo mais por activity.stagingId.
    const expectedEngineId = deriveEngineActivityId(activity.sourceKey, activity.sourceItemId);
    expect(publicActivity.findPublicationStateByEngineId).toHaveBeenCalledWith(expectedEngineId);
    expect(publicActivity.update).toHaveBeenCalledWith(publicId, expect.anything());
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ActivityUpdated', entityId: publicId }),
    );
    expect(metrics.activitiesUpdated).toBe(1);
    expect(metrics.activitiesSkipped).toBe(0);
  });

  it('ignora activity n├úo dirty (staging.updated_at <= public.last_published_at) ÔÇö zero writes, zero eventos', async () => {
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

  it('promotedActivityId preenchido mas sem registo p├║blico correspondente (identidade est├ível) ├® erro ÔÇö n├úo insert (Level 2 review, 2026-09-23, restaura garantia de integridade)', async () => {
    const activity = makeActivity({
      sourceItemId:       'orphan-promoted-001',
      promotedActivityId: 'activity-ghost-001' as PublicActivityId, // alega j├í promovida
      stagingUpdatedAt:   new Date(),
    });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({
      findDirty: [activity],
      publicationState: vi.fn().mockResolvedValue(null), // mas nenhum registo p├║blico real
    });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(metrics.errors).toBe(1);
    expect(metrics.activitiesPublished).toBe(0);
    expect(metrics.activitiesUpdated).toBe(0);
    expect(publicActivity.insert).not.toHaveBeenCalled();
    expect(publicActivity.update).not.toHaveBeenCalled();
  });

  it('nova observa├º├úo de staging (promotedActivityId null) reconcilia com public.activities j├í existente sob a mesma identidade de fonte ÔÇö UPDATE, n├úo INSERT duplicado (Level 2 review, 2026-09-23, caso central da Stable Source Activity Identity)', async () => {
    const publicId = 'activity-reconciled-001' as PublicActivityId;
    // Modela uma NOVA linha de staging (esta linha espec├¡fica nunca foi
    // promovida ÔÇö promotedActivityId null), mas cuja identidade de fonte
    // (sourceKey+sourceItemId) j├í tem uma public.activities publicada via
    // uma linha de staging anterior e diferente ÔÇö exactamente o cen├írio
    // "Run 1 ÔåÆ staging A ÔåÆ publicado; Run 2 ÔåÆ staging B ÔåÆ mesma fonte"
    // que motivou toda esta correc├º├úo.
    const activity = makeActivity({
      stagingId:           'sa-recollected' as StagingActivityId,
      sourceItemId:        'reconcile-001',
      promotedActivityId:  null, // esta linha nunca foi promovida ela pr├│pria
      stagingUpdatedAt:    new Date('2026-07-08T00:00:00.000Z'), // mais recente que o ├║ltimo publish
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.insert).not.toHaveBeenCalled(); // N├âO duplica
    expect(publicActivity.update).toHaveBeenCalledWith(publicId, expect.anything());
    expect(publicActivity.linkToStaging).toHaveBeenCalledWith(activity.stagingId, publicId);
    expect(metrics.activitiesUpdated).toBe(1);
    expect(metrics.activitiesPublished).toBe(0);
    expect(metrics.errors).toBe(0);
  });
});

// ÔöÇÔöÇ Arquiva├º├úo (capacidade expl├¡cita) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

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

  it('lan├ºa erro quando a activity n├úo tem registo correspondente em public.activities', async () => {
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({
      publicationState: vi.fn().mockResolvedValue(null),
    });
    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);

    await expect(publisher.archiveActivity('ea-inexistente' as EngineActivityId, RUN_ID, PRODUCT_KEY))
      .rejects.toThrow();
    expect(publicActivity.archive).not.toHaveBeenCalled();
  });

  it('publish() n├úo descobre activities a arquivar por outros motivos automaticamente', async () => {
    const activity = makeActivity();
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.archive).not.toHaveBeenCalled();
    expect(metrics.activitiesArchived).toBe(0);
  });
});

// ÔöÇÔöÇ Campos preservados (ADR-0018) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

describe('ActivityPublisher ÔÇö campos preservados', () => {
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

// ÔöÇÔöÇ M├®tricas ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

describe('ActivityPublisher ÔÇö m├®tricas', () => {
  it('agrega correctamente publicadas, actualizadas e ignoradas numa ├║nica run', async () => {
    // Level 3, 2026-09-23 ÔÇö tr├¬s identidades de fonte DISTINTAS
    // (sourceItemId diferente cada), porque ├® isso, n├úo stagingId, que
    // agora decide insert/update via a identidade est├ível derivada.
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

  it('um erro numa activity n├úo interrompe o processamento das restantes', async () => {
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

// ÔöÇÔöÇ Anti-Corruption Layer (adaptador) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

describe('ActivityPublisher.adaptToPublishableActivity', () => {
  it('fun├º├úo pura: reconstr├│i PublishableActivity a partir do OperationalActivityInput + original', () => {
    const original = makeActivity({ promotedActivityId: 'activity-x' as PublicActivityId });
    const operational = {
      title:              'T├¡tulo Transformado',
      description:        'Descri├º├úo',
      start_date:         new Date('2026-08-01T09:00:00.000Z'),
      end_date:            null,
      imagem_url:          'https://x.com/img.jpg',
      url:                 'https://x.com',
      phone:               '123',
      venue_id:            'venue-y' as PublicVenueId,
      // Level 3, 2026-09-23 ÔÇö engine_activity_id ├® EngineActivityId, n├úo
      // StagingActivityId; cast expl├¡cito aqui s├│ para construir a
      // fixture de teste (mesmo padr├úo usado em ActivityPublisher.ts,
      // adaptToPublishableActivity).
      engine_activity_id:  original.stagingId as unknown as EngineActivityId,
      source_key:          original.sourceKey,
      product_key:         original.productKey,
      engine_status:       'active' as const,
      last_published_at:   NOW,
    };

    const adapted = ActivityPublisher.adaptToPublishableActivity(operational, original);

    expect(adapted.title).toBe('T├¡tulo Transformado');
    expect(adapted.imageUrl).toBe('https://x.com/img.jpg');
    expect(adapted.resolvedPublicVenueId).toBe('venue-y');
    expect(adapted.stagingId).toBe(original.stagingId);
    expect(adapted.sourceItemId).toBe(original.sourceItemId); // pass-through
    expect(adapted.promotedActivityId).toBe('activity-x');
    expect(adapted.stagingUpdatedAt).toBe(original.stagingUpdatedAt);
    expect(adapted.occurrences).toBe(original.occurrences); // pass-through
  });
});

// ÔöÇÔöÇ preview() ÔÇö Sprint 8.7 ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

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

  it('classifica activity nova com ocorr├¬ncia futura como insert', async () => {
    const activity = makeActivity({ occurrences: [FUTURE_OCCURRENCE] });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]!.action).toBe('insert');
    if (decisions[0]!.action === 'insert') {
      expect(decisions[0].operational.start_date).toEqual(new Date('2026-08-01T09:00:00.000Z'));
    }
  });

  it('classifica activity nova sem ocorr├¬ncia futura como skip_expired', async () => {
    const activity = makeActivity({ occurrences: [PAST_OCCURRENCE] });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]!.action).toBe('skip_expired');
  });

  it('classifica activity dirty ainda v├ílida como update', async () => {
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

  it('classifica activity n├úo-dirty como skip_not_dirty', async () => {
    const publicId = 'activity-z' as PublicActivityId;
    const activity = makeActivity({ sourceItemId: 'preview-clean-001', promotedActivityId: publicId, stagingUpdatedAt: new Date('2026-07-01T00:00:00.000Z') });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findDirty: [activity], publicationState });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]).toMatchObject({ action: 'skip_not_dirty', publicActivityId: publicId });
  });

  it('resolvedPublicVenueId (venue resolvido ou NULL) est├í sempre dispon├¡vel via decision.activity, mesmo em skip_expired', async () => {
    const withVenue    = makeActivity({ stagingId: 'sa-v1' as StagingActivityId, sourceItemId: 'preview-v1', resolvedPublicVenueId: 'venue-1' as PublicVenueId, occurrences: [PAST_OCCURRENCE] });
    const withoutVenue = makeActivity({ stagingId: 'sa-v2' as StagingActivityId, sourceItemId: 'preview-v2', resolvedPublicVenueId: null, venueResolutionStatus: 'proposed_new', resolvedVenueStagingId: null, occurrences: [PAST_OCCURRENCE] });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [withVenue, withoutVenue] });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]!.activity.resolvedPublicVenueId).toBe('venue-1');
    expect(decisions[1]!.activity.resolvedPublicVenueId).toBeNull();
  });

  it('classifica promotedActivityId ├│rf├úo como error, sem nenhuma escrita (Level 2 review, 2026-09-23)', async () => {
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

  it('publish() e preview() produzem a mesma classifica├º├úo para o mesmo estado (sem diverg├¬ncia)', async () => {
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

// ── Gate de decisão humana para matched (Level 2, 2026-09-26) ─────────────

describe('ActivityPublisher — gate de decisão humana para matched', () => {
  function makeDecisionRepo(overrides: { findLatestImpl?: ReturnType<typeof vi.fn> } = {}): IVenueResolutionDecisionRepository {
    return {
      record:     vi.fn().mockResolvedValue('decision-mock-001'),
      findLatest: overrides.findLatestImpl ?? vi.fn().mockResolvedValue(null),
    } as unknown as IVenueResolutionDecisionRepository;
  }

  function makeValidDecision(): ResolutionDecision {
    return {
      action:             'matched',
      acceptedCandidateId: 'candidate-row-001' as CandidateId,
    } as unknown as ResolutionDecision;
  }

  it('A. decisionRepo fornecido + matched + decisão humana válida existente → insert prossegue normalmente', async () => {
    const activity = makeActivity({ venueResolutionStatus: 'matched' });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });
    const decisionRepo = makeDecisionRepo({ findLatestImpl: vi.fn().mockResolvedValue(makeValidDecision()) });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW, decisionRepo);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.insert).toHaveBeenCalledTimes(1);
    expect(metrics.activitiesPublished).toBe(1);
    expect(metrics.activitiesSkipped).toBe(0);
  });

  it('B. decisionRepo fornecido + matched + SEM decisão humana → skip_missing_human_decision, zero writes', async () => {
    const activity = makeActivity({ venueResolutionStatus: 'matched' });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });
    const decisionRepo = makeDecisionRepo({ findLatestImpl: vi.fn().mockResolvedValue(null) });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW, decisionRepo);
    const decisions = await publisher.preview(PRODUCT_KEY);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(decisions[0]!.action).toBe('skip_missing_human_decision');
    expect(publicActivity.insert).not.toHaveBeenCalled();
    expect(publicActivity.update).not.toHaveBeenCalled();
    expect(publicActivity.archive).not.toHaveBeenCalled();
    expect(publicActivity.linkToStaging).not.toHaveBeenCalled();
    expect(eventRepo.record).not.toHaveBeenCalled();
    expect(metrics.activitiesSkipped).toBe(1);
    expect(metrics.activitiesPublished).toBe(0);
  });

  it('C. decisionRepo fornecido + matched + decisão válida + ocorrência expirada → skip_expired (lógica existente prossegue normalmente após o gate passar)', async () => {
    const activity = makeActivity({ venueResolutionStatus: 'matched', occurrences: [PAST_OCCURRENCE] });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });
    const decisionRepo = makeDecisionRepo({ findLatestImpl: vi.fn().mockResolvedValue(makeValidDecision()) });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW, decisionRepo);
    const decisions = await publisher.preview(PRODUCT_KEY);

    expect(decisions[0]!.action).toBe('skip_expired'); // não skip_missing_human_decision
  });

  it('D. decisionRepo AUSENTE (undefined) → gate nunca aplicado, comportamento idêntico ao anterior a esta mudança', async () => {
    const activity = makeActivity({ venueResolutionStatus: 'matched' });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });

    // Construtor com só 4 argumentos — exactamente como todos os outros
    // ~20 testes deste arquivo já fazem, sem nenhuma alteração a eles.
    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicActivity.insert).toHaveBeenCalledTimes(1);
    expect(metrics.activitiesPublished).toBe(1);
  });

  it('proposed_new nunca é bloqueada pelo gate, mesmo com decisionRepo fornecido e sem nenhuma decisão humana', async () => {
    const activity = makeActivity({
      venueResolutionStatus: 'proposed_new',
      resolvedPublicVenueId: null,
      resolvedVenueStagingId: null,
    });
    const { publishableActivity, publicActivity, eventRepo } = makeRepos({ findUnpublished: [activity] });
    const decisionRepo = makeDecisionRepo({ findLatestImpl: vi.fn().mockResolvedValue(null) });

    const publisher = new ActivityPublisher(publishableActivity, publicActivity, eventRepo, () => NOW, decisionRepo);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(decisionRepo.findLatest).not.toHaveBeenCalled(); // gate nem é consultado para proposed_new
    expect(publicActivity.insert).toHaveBeenCalledTimes(1);
    expect(metrics.activitiesPublished).toBe(1);
  });
});
