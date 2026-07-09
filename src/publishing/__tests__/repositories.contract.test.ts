/**
 * src/publishing/__tests__/repositories.contract.test.ts
 * Testes de contrato com mocks — zero Supabase, zero rede.
 */

import { describe, it, expect, vi } from 'vitest';
import { PublishingRepositoryFactory }  from '../repositories/factory.js';
import type { IPublishingRepositorySet } from '../repositories/interfaces.js';
import type {
  PublicationRunId,
  PublicVenueId,
  PublicActivityId,
  StagingVenueId,
  StagingActivityId,
  PublishableVenue,
  PublishableActivity,
} from '../types/domain.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RUN_ID      = 'run-001'  as PublicationRunId;
const VENUE_ID    = 'venue-001' as PublicVenueId;
const ACTIVITY_ID = 'act-001'  as PublicActivityId;
const S_VENUE_ID  = 'sv-001'   as StagingVenueId;
const S_ACT_ID    = 'sa-001'   as StagingActivityId;

const mockVenue: PublishableVenue = {
  stagingId:        S_VENUE_ID,
  productKey:       'vivere-60-mais',
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
  stagingUpdatedAt: new Date('2026-07-01'),
};

const mockActivity: PublishableActivity = {
  stagingId:             S_ACT_ID,
  productKey:            'vivere-60-mais',
  sourceKey:             'prefeitura_cabo_frio',
  title:                 'Yoga no Forte',
  description:           'Aula de yoga na praia',
  startDate:             new Date('2026-08-01'),
  endDate:               null,
  imageUrl:              null,
  sourceUrl:             'https://cabofrio.rj.gov.br/yoga',
  phone:                 null,
  resolvedPublicVenueId: VENUE_ID,
  promotedActivityId:    null,
  stagingUpdatedAt:      new Date('2026-07-01'),
};

// ── Mock factory ──────────────────────────────────────────────────────────────

function makeMockRepos(): IPublishingRepositorySet {
  return PublishingRepositoryFactory.fromObject({
    publishableVenue: {
      findUnpublished: vi.fn().mockResolvedValue([mockVenue]),
      findDirty:       vi.fn().mockResolvedValue([]),
      findToArchive:   vi.fn().mockResolvedValue([]),
    },
    publishableActivity: {
      findUnpublished: vi.fn().mockResolvedValue([mockActivity]),
      findDirty:       vi.fn().mockResolvedValue([]),
    },
    publicVenue: {
      insert:         vi.fn().mockResolvedValue(VENUE_ID),
      update:         vi.fn().mockResolvedValue(undefined),
      archive:        vi.fn().mockResolvedValue(undefined),
      linkToStaging:  vi.fn().mockResolvedValue(undefined),
      findByEngineId: vi.fn().mockResolvedValue(null),
      // Método aditivo (Sprint 8.4) — não altera nenhum método existente.
      findPublicationStateByEngineId: vi.fn().mockResolvedValue(null),
    },
    publicActivity: {
      insert:         vi.fn().mockResolvedValue(ACTIVITY_ID),
      update:         vi.fn().mockResolvedValue(undefined),
      archive:        vi.fn().mockResolvedValue(undefined),
      linkToStaging:  vi.fn().mockResolvedValue(undefined),
      findByEngineId: vi.fn().mockResolvedValue(null),
    },
    run: {
      start:             vi.fn().mockResolvedValue(RUN_ID),
      finish:            vi.fn().mockResolvedValue(undefined),
      markFailed:        vi.fn().mockResolvedValue(undefined),
      findActive:        vi.fn().mockResolvedValue(null),
      findLastCompleted: vi.fn().mockResolvedValue(null),
    },
    event: {
      record: vi.fn().mockResolvedValue('evt-001'),
    },
  });
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('PublishingRepositoryFactory.fromObject', () => {
  it('retorna o mesmo objecto sem transformação', () => {
    const repos = makeMockRepos();
    expect(PublishingRepositoryFactory.fromObject(repos)).toBe(repos);
  });

  it('forSupabase lança sem .env (ambiente CI)', async () => {
    await expect(PublishingRepositoryFactory.forSupabase()).rejects.toThrow();
  });
});

describe('IPublishableVenueRepository (contrato)', () => {
  it('findUnpublished retorna venues prontos', async () => {
    const repos  = makeMockRepos();
    const result = await repos.publishableVenue.findUnpublished('vivere-60-mais');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Praia do Forte');
    expect(result[0]!.promotedVenueId).toBeNull();
  });

  it('findDirty retorna array (vazio no mock)', async () => {
    const repos  = makeMockRepos();
    const result = await repos.publishableVenue.findDirty('vivere-60-mais');
    expect(Array.isArray(result)).toBe(true);
  });

  it('findToArchive retorna array', async () => {
    const repos  = makeMockRepos();
    const result = await repos.publishableVenue.findToArchive('vivere-60-mais');
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('IPublishableActivityRepository (contrato)', () => {
  it('findUnpublished retorna activities com venue resolvido', async () => {
    const repos  = makeMockRepos();
    const result = await repos.publishableActivity.findUnpublished('vivere-60-mais');
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Yoga no Forte');
    expect(result[0]!.resolvedPublicVenueId).toBe(VENUE_ID);
  });
});

describe('IPublicVenueRepository (contrato)', () => {
  it('insert retorna PublicVenueId', async () => {
    const repos  = makeMockRepos();
    const id     = await repos.publicVenue.insert(mockVenue, RUN_ID);
    expect(id).toBe(VENUE_ID);
  });

  it('update chamado com publicVenueId e venue', async () => {
    const repos = makeMockRepos();
    await repos.publicVenue.update(VENUE_ID, mockVenue);
    expect(repos.publicVenue.update).toHaveBeenCalledWith(VENUE_ID, mockVenue);
  });

  it('archive chamado com publicVenueId', async () => {
    const repos = makeMockRepos();
    await repos.publicVenue.archive(VENUE_ID);
    expect(repos.publicVenue.archive).toHaveBeenCalledWith(VENUE_ID);
  });

  it('linkToStaging chamado com ambos os IDs', async () => {
    const repos = makeMockRepos();
    await repos.publicVenue.linkToStaging(S_VENUE_ID, VENUE_ID);
    expect(repos.publicVenue.linkToStaging).toHaveBeenCalledWith(S_VENUE_ID, VENUE_ID);
  });

  it('findByEngineId retorna null quando não publicado', async () => {
    const repos  = makeMockRepos();
    const result = await repos.publicVenue.findByEngineId(S_VENUE_ID);
    expect(result).toBeNull();
  });

  it('findPublicationStateByEngineId retorna null quando não publicado (método aditivo, Sprint 8.4)', async () => {
    const repos  = makeMockRepos();
    const result = await repos.publicVenue.findPublicationStateByEngineId(S_VENUE_ID);
    expect(result).toBeNull();
  });
});

describe('IPublicActivityRepository (contrato)', () => {
  it('insert retorna PublicActivityId', async () => {
    const repos = makeMockRepos();
    const id    = await repos.publicActivity.insert(mockActivity, RUN_ID);
    expect(id).toBe(ACTIVITY_ID);
  });
});

describe('IPublicationRunRepository (contrato)', () => {
  it('start retorna RunId', async () => {
    const repos = makeMockRepos();
    const id    = await repos.run.start('vivere-60-mais', 'manual');
    expect(id).toBe(RUN_ID);
  });

  it('finish chamado com métricas completas', async () => {
    const repos = makeMockRepos();
    await repos.run.finish(RUN_ID, {
      venuesPublished: 2, venuesUpdated: 0, venuesSkipped: 1, venuesArchived: 0,
      activitiesPublished: 3, activitiesUpdated: 0, activitiesSkipped: 2, activitiesArchived: 0,
      errors: 0, durationMs: 1250,
    });
    expect(repos.run.finish).toHaveBeenCalled();
  });

  it('findActive retorna null quando sem run activa', async () => {
    const repos  = makeMockRepos();
    const result = await repos.run.findActive('vivere-60-mais');
    expect(result).toBeNull();
  });

  it('markFailed chamado com runId e reason', async () => {
    const repos = makeMockRepos();
    await repos.run.markFailed(RUN_ID, 'erro de teste');
    expect(repos.run.markFailed).toHaveBeenCalledWith(RUN_ID, 'erro de teste');
  });
});

describe('IPublicationEventRepository (contrato)', () => {
  it('record chamado e retorna EventId', async () => {
    const repos = makeMockRepos();
    const id    = await repos.event.record({
      eventType:  'VenuePublished',
      entityType: 'venue',
      entityId:   VENUE_ID,
      productKey: 'vivere-60-mais',
      runId:      RUN_ID,
      payload:    { name: 'Praia do Forte' },
    });
    expect(id).toBe('evt-001');
  });
});

describe('Whitelist ADR-0018 — campos preservados', () => {
  it('PublishableVenue não expõe category', () => {
    const keys = Object.keys(mockVenue);
    expect(keys).not.toContain('category');
  });

  it('PublishableActivity não expõe schedule, price, is_free, is_sponsored, interested_count', () => {
    const keys = Object.keys(mockActivity);
    expect(keys).not.toContain('schedule');
    expect(keys).not.toContain('price');
    expect(keys).not.toContain('is_free');
    expect(keys).not.toContain('is_sponsored');
    expect(keys).not.toContain('interested_count');
  });

  it('PublishableActivity usa imageUrl (não imagem_url) internamente', () => {
    // O typo só aparece no mapeamento para o banco — não nos tipos de domínio
    const keys = Object.keys(mockActivity);
    expect(keys).toContain('imageUrl');
    expect(keys).not.toContain('imagem_url');
  });
});
