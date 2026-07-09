/**
 * src/publishing/__tests__/VenuePublisher.test.ts
 * Sprint 8.4 — testes com mocks. Zero Supabase, zero rede.
 *
 * VenuePublisher depende apenas de três colaboradores — IPublishableVenueRepository,
 * IPublicVenueRepository, IPublicationEventRepository. O dirty check usa
 * IPublicVenueRepository.findPublicationStateByEngineId() (método aditivo).
 */

import { describe, it, expect, vi } from 'vitest';
import { VenuePublisher } from '../services/VenuePublisher.js';
import type {
  IPublishableVenueRepository,
  IPublicVenueRepository,
  IPublicationEventRepository,
} from '../repositories/interfaces.js';
import type {
  PublishableVenue,
  PublicVenueId,
  StagingVenueId,
  PublicationRunId,
  PublicationEventId,
  PublicVenuePublicationState,
} from '../types/domain.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RUN_ID       = 'run-001'   as PublicationRunId;
const PRODUCT_KEY  = 'vivere-60-mais';
const NOW          = new Date('2026-07-09T12:00:00.000Z');

function makeVenue(overrides: Partial<PublishableVenue> = {}): PublishableVenue {
  return {
    stagingId:        'sv-001' as StagingVenueId,
    productKey:       PRODUCT_KEY,
    sourceKey:        'google_places',
    name:             'Praia do Forte',
    address:          'Cabo Frio - RJ',
    lat:              -22.875,
    lng:              -42.008,
    phone:            null,
    website:          null,
    openingHoursRaw:  null,
    imageUrl:         null,
    promotedVenueId:  null,
    stagingUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepos(overrides: {
  findUnpublished?:  readonly PublishableVenue[];
  findDirty?:        readonly PublishableVenue[];
  findToArchive?:    readonly PublishableVenue[];
  insertImpl?:       ReturnType<typeof vi.fn>;
  updateImpl?:       ReturnType<typeof vi.fn>;
  archiveImpl?:      ReturnType<typeof vi.fn>;
  publicationState?: ReturnType<typeof vi.fn>;
} = {}) {
  const publishableVenue: IPublishableVenueRepository = {
    findUnpublished: vi.fn().mockResolvedValue(overrides.findUnpublished ?? []),
    findDirty:       vi.fn().mockResolvedValue(overrides.findDirty ?? []),
    findToArchive:   vi.fn().mockResolvedValue(overrides.findToArchive ?? []),
  };

  const publicVenue: IPublicVenueRepository = {
    insert:                         overrides.insertImpl       ?? vi.fn().mockResolvedValue('venue-new-001' as PublicVenueId),
    update:                         overrides.updateImpl       ?? vi.fn().mockResolvedValue(undefined),
    archive:                        overrides.archiveImpl      ?? vi.fn().mockResolvedValue(undefined),
    linkToStaging:                  vi.fn().mockResolvedValue(undefined),
    findByEngineId:                 vi.fn().mockResolvedValue(null),
    findPublicationStateByEngineId: overrides.publicationState ?? vi.fn().mockResolvedValue(null),
  };

  const eventRepo: IPublicationEventRepository = {
    record: vi.fn().mockResolvedValue('evt-001' as PublicationEventId),
  };

  return { publishableVenue, publicVenue, eventRepo };
}

function makeState(publicVenueId: PublicVenueId, lastPublishedAt: Date): PublicVenuePublicationState {
  return { publicVenueId, lastPublishedAt, engineStatus: 'active' };
}

// ── Publica venue novo ────────────────────────────────────────────────────────

describe('VenuePublisher — venue novo', () => {
  it('publica venue novo: insert + linkToStaging + evento VenuePublished + métricas', async () => {
    const venue = makeVenue();
    const { publishableVenue, publicVenue, eventRepo } = makeRepos({ findUnpublished: [venue] });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicVenue.insert).toHaveBeenCalledTimes(1);
    expect(publicVenue.linkToStaging).toHaveBeenCalledWith(venue.stagingId, 'venue-new-001');
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'VenuePublished', entityType: 'venue', entityId: 'venue-new-001', runId: RUN_ID }),
    );
    expect(metrics.venuesPublished).toBe(1);
    expect(metrics.venuesUpdated).toBe(0);
    expect(metrics.venuesSkipped).toBe(0);
    expect(metrics.errors).toBe(0);
  });

  it('o payload de insert é derivado do PublicationTransformer, não do venue original directamente', async () => {
    const venue = makeVenue({ name: 'Nome Curado', openingHoursRaw: 'Mon-Fri 08:00-18:00' });
    const { publishableVenue, publicVenue, eventRepo } = makeRepos({ findUnpublished: [venue] });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    await publisher.publish(PRODUCT_KEY, RUN_ID);

    const [adaptedVenue] = (publicVenue.insert as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(adaptedVenue.name).toBe('Nome Curado');
    expect(adaptedVenue.openingHoursRaw).toBe('Mon-Fri 08:00-18:00'); // COPY puro, sem normalização
  });

  it('não consulta findPublicationStateByEngineId para venues novos (sem dirty check)', async () => {
    const venue = makeVenue();
    const { publishableVenue, publicVenue, eventRepo } = makeRepos({ findUnpublished: [venue] });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicVenue.findPublicationStateByEngineId).not.toHaveBeenCalled();
  });
});

// ── Dirty check real (via findPublicationStateByEngineId) ────────────────────

describe('VenuePublisher — dirty check', () => {
  it('actualiza venue existente quando dirty (staging.updated_at > public.last_published_at)', async () => {
    const publicId = 'venue-existing-001' as PublicVenueId;
    const venue = makeVenue({
      stagingId:        'sv-dirty-001' as StagingVenueId,
      promotedVenueId:  publicId,
      stagingUpdatedAt: new Date('2026-07-05T00:00:00.000Z'), // mais recente
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableVenue, publicVenue, eventRepo } = makeRepos({ findDirty: [venue], publicationState });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicVenue.findPublicationStateByEngineId).toHaveBeenCalledWith(venue.stagingId);
    expect(publicVenue.update).toHaveBeenCalledTimes(1);
    expect(publicVenue.update).toHaveBeenCalledWith(publicId, expect.anything());
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'VenueUpdated', entityId: publicId }),
    );
    expect(metrics.venuesUpdated).toBe(1);
    expect(metrics.venuesSkipped).toBe(0);
  });

  it('ignora venue não dirty (staging.updated_at <= public.last_published_at) — zero writes, zero eventos', async () => {
    const publicId = 'venue-existing-002' as PublicVenueId;
    const venue = makeVenue({
      stagingId:        'sv-dirty-002' as StagingVenueId,
      promotedVenueId:  publicId,
      stagingUpdatedAt: new Date('2026-07-01T00:00:00.000Z'), // igual
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableVenue, publicVenue, eventRepo } = makeRepos({ findDirty: [venue], publicationState });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicVenue.update).not.toHaveBeenCalled();
    expect(eventRepo.record).not.toHaveBeenCalled();
    expect(metrics.venuesSkipped).toBe(1);
    expect(metrics.venuesUpdated).toBe(0);
  });

  it('ignora venue quando staging.updated_at é anterior a public.last_published_at', async () => {
    const publicId = 'venue-existing-003' as PublicVenueId;
    const venue = makeVenue({
      stagingId:        'sv-dirty-003' as StagingVenueId,
      promotedVenueId:  publicId,
      stagingUpdatedAt: new Date('2026-06-01T00:00:00.000Z'), // mais antigo
    });
    const publicationState = vi.fn().mockResolvedValue(makeState(publicId, new Date('2026-07-01T00:00:00.000Z')));
    const { publishableVenue, publicVenue, eventRepo } = makeRepos({ findDirty: [venue], publicationState });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicVenue.update).not.toHaveBeenCalled();
    expect(metrics.venuesSkipped).toBe(1);
  });
});

// ── Arquivação ────────────────────────────────────────────────────────────────

describe('VenuePublisher — arquivação', () => {
  it('arquiva venue rejeitado após publicação + evento VenueArchived', async () => {
    const publicId = 'venue-rejected-001' as PublicVenueId;
    const venue = makeVenue({ promotedVenueId: publicId });
    const { publishableVenue, publicVenue, eventRepo } = makeRepos({ findToArchive: [venue] });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(publicVenue.archive).toHaveBeenCalledWith(publicId);
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'VenueArchived', entityId: publicId }),
    );
    expect(metrics.venuesArchived).toBe(1);
  });
});

// ── Campos preservados (ADR-0018) ─────────────────────────────────────────────

describe('VenuePublisher — campos preservados', () => {
  it('nunca inclui category no payload adaptado', async () => {
    const venue = makeVenue();
    const { publishableVenue, publicVenue, eventRepo } = makeRepos({ findUnpublished: [venue] });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    await publisher.publish(PRODUCT_KEY, RUN_ID);

    const [adaptedVenue] = (publicVenue.insert as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(Object.keys(adaptedVenue)).not.toContain('category');
  });
});

// ── Métricas ──────────────────────────────────────────────────────────────────

describe('VenuePublisher — métricas', () => {
  it('agrega correctamente publicados, actualizados, ignorados e arquivados numa única run', async () => {
    const newVenue = makeVenue({ stagingId: 'sv-new' as StagingVenueId });

    const dirtyVenue = makeVenue({
      stagingId:        'sv-dirty' as StagingVenueId,
      promotedVenueId:  'venue-dirty' as PublicVenueId,
      stagingUpdatedAt: new Date('2026-07-08T00:00:00.000Z'),
    });
    const cleanVenue = makeVenue({
      stagingId:        'sv-clean' as StagingVenueId,
      promotedVenueId:  'venue-clean' as PublicVenueId,
      stagingUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    const archivedVenue = makeVenue({
      stagingId:       'sv-archived' as StagingVenueId,
      promotedVenueId: 'venue-archived' as PublicVenueId,
    });

    const publicationState = vi.fn().mockImplementation((engineVenueId: StagingVenueId) => {
      if (engineVenueId === 'sv-dirty') {
        return Promise.resolve(makeState('venue-dirty' as PublicVenueId, new Date('2026-07-01T00:00:00.000Z'))); // dirty
      }
      if (engineVenueId === 'sv-clean') {
        return Promise.resolve(makeState('venue-clean' as PublicVenueId, new Date('2026-07-01T00:00:00.000Z'))); // igual → skip
      }
      return Promise.resolve(null);
    });

    const { publishableVenue, publicVenue, eventRepo } = makeRepos({
      findUnpublished:  [newVenue],
      findDirty:        [dirtyVenue, cleanVenue],
      findToArchive:    [archivedVenue],
      publicationState,
    });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(metrics).toEqual({
      venuesPublished: 1,
      venuesUpdated:   1,
      venuesSkipped:   1,
      venuesArchived:  1,
      errors:          0,
      durationMs:      0, // clock injectado é constante (NOW) → duração 0
    });
  });

  it('um erro num venue não interrompe o processamento dos restantes — é contabilizado em errors', async () => {
    const venueOk   = makeVenue({ stagingId: 'sv-ok' as StagingVenueId });
    const venueFail = makeVenue({ stagingId: 'sv-fail' as StagingVenueId });

    const insertImpl = vi.fn()
      .mockRejectedValueOnce(new Error('falha simulada de escrita'))
      .mockResolvedValueOnce('venue-ok' as PublicVenueId);

    const { publishableVenue, publicVenue, eventRepo } = makeRepos({
      findUnpublished: [venueFail, venueOk],
      insertImpl,
    });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(metrics.errors).toBe(1);
    expect(metrics.venuesPublished).toBe(1);
  });

  it('erro no dirty check (staging venue sem registo em public.venues) é contabilizado em errors', async () => {
    const venue = makeVenue({ promotedVenueId: 'venue-orfao' as PublicVenueId, stagingUpdatedAt: new Date() });
    const { publishableVenue, publicVenue, eventRepo } = makeRepos({
      findDirty: [venue],
      publicationState: vi.fn().mockResolvedValue(null), // sem registo correspondente
    });

    const publisher = new VenuePublisher(publishableVenue, publicVenue, eventRepo, () => NOW);
    const metrics = await publisher.publish(PRODUCT_KEY, RUN_ID);

    expect(metrics.errors).toBe(1);
    expect(publicVenue.update).not.toHaveBeenCalled();
  });
});

// ── Anti-Corruption Layer (adaptador) ─────────────────────────────────────────

describe('VenuePublisher.adaptToPublishableVenue', () => {
  it('função pura: reconstrói PublishableVenue a partir do OperationalVenueInput + original', () => {
    const original = makeVenue({ promotedVenueId: 'venue-x' as PublicVenueId });
    const operational = {
      name:              'Nome Transformado',
      address:           'Endereço X',
      lat:               1,
      lng:               2,
      phone:             '123',
      website:           'https://x.com',
      opening_hours:     'raw-hours',
      image_url:         'https://x.com/img.jpg',
      engine_venue_id:   original.stagingId,
      source_key:        original.sourceKey,
      product_key:       original.productKey,
      engine_status:     'active' as const,
      last_published_at: NOW,
    };

    const adapted = VenuePublisher.adaptToPublishableVenue(operational, original);

    expect(adapted.name).toBe('Nome Transformado');
    expect(adapted.openingHoursRaw).toBe('raw-hours');
    expect(adapted.stagingId).toBe(original.stagingId);
    expect(adapted.promotedVenueId).toBe('venue-x');
    expect(adapted.stagingUpdatedAt).toBe(original.stagingUpdatedAt);
  });
});
