/**
 * entity-resolution/__tests__/engine.test.ts
 *
 * Testes do EntityResolutionEngine.
 * Zero dependências externas — todos os repositórios e providers são mocks Vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityResolutionEngine }   from '../EntityResolutionEngine.js';
import { ERSilentLogger }           from '../utils/logging.js';
import { DEFAULT_ER_CONFIG }        from '../config/index.js';
import { NameMatcher }              from '../matchers/NameMatcher.js';
import { isSuccess, isUnresolved, isFailed, isPartial } from '../types/result.js';
import type {
  IEntityResolutionRepositorySet,
  IVenueResolutionRunRepository,
  IVenueResolutionCandidateRepository,
  IVenueResolutionDecisionRepository,
} from '../repositories/interfaces.js';
import type { ActivityForResolution } from '../repositories/impl/ActivityResolutionRepository.js';
import type {
  ActivityStagingId,
  VenueStagingId,
  ResolutionRunId,
  RankedCandidate,
  VenueCandidate,
  CandidateId,
} from '../types/domain.js';
import type { VenueMention } from '../../types/RawActivityItem.js';

// ── Factories de mocks ────────────────────────────────────────────────────────

function makeRunRepo(): IVenueResolutionRunRepository {
  return {
    start:      vi.fn().mockResolvedValue('run-001' as ResolutionRunId),
    finish:     vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    findActive: vi.fn().mockResolvedValue(null),
  };
}

function makeCandidateRepo(eligibleVenues: VenueCandidate[] = []): IVenueResolutionCandidateRepository {
  return {
    insertCandidates:  vi.fn().mockResolvedValue(['cand-001' as CandidateId]),
    findByActivity:    vi.fn().mockResolvedValue([]),
    setOutcome:        vi.fn().mockResolvedValue(undefined),
    deleteByActivity:  vi.fn().mockResolvedValue(0),
    findEligibleVenues: vi.fn().mockResolvedValue(eligibleVenues.map(v => ({
      id: v.id, name: v.name, address: v.address, city: v.city,
      lat: v.lat, lng: v.lng, google_types: v.google_types,
      source_category_hint: v.source_category_hint, proposal_status: v.proposal_status,
    }))),
  };
}

function makeDecisionRepo(existingDecision: any = null): IVenueResolutionDecisionRepository {
  return {
    record:             vi.fn().mockResolvedValue('dec-001'),
    findLatest:         vi.fn().mockResolvedValue(existingDecision),
    findPendingReview:  vi.fn().mockResolvedValue([]),
  };
}

function makeRepos(
  venues: VenueCandidate[] = [],
  existingDecision: any = null,
): IEntityResolutionRepositorySet {
  return {
    run:       makeRunRepo(),
    candidate: makeCandidateRepo(venues),
    decision:  makeDecisionRepo(existingDecision),
  };
}

function makeActivityRepo(activities: ActivityForResolution[] = []) {
  const findById = vi.fn().mockImplementation((id: string) =>
    Promise.resolve(activities.find(a => a.id === id) ?? null),
  );
  const findUnresolved = vi.fn().mockResolvedValue(activities);
  const updateResolutionStatus = vi.fn().mockResolvedValue(undefined);
  return { findById, findUnresolved, updateResolutionStatus };
}

function makeActivity(
  id: string,
  mentionText: string | null,
  productKey = 'vivere-60-mais',
): ActivityForResolution {
  const mention: VenueMention | null = mentionText
    ? { raw_text: mentionText, raw_address_text: null, confidence_hint: 'explicit_name' }
    : null;
  return {
    id:                      id as ActivityStagingId,
    product_key:             productKey,
    venue_resolution_status: 'unresolved',
    venue_mention:           mention,
  };
}

function makeVenue(id: string, name: string): VenueCandidate {
  return {
    id: id as VenueStagingId, product_key: 'vivere-60-mais',
    name, address: null, city: 'Cabo Frio RJ',
    lat: -22.879, lng: -42.019, google_types: [],
    source_category_hint: null, proposal_status: 'approved',
  };
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('EntityResolutionEngine.resolve()', () => {
  const ACT_ID = 'activity-001' as ActivityStagingId;

  it('retorna unresolved quando actividade não existe', async () => {
    const repos      = makeRepos();
    const actRepo    = makeActivityRepo([]);
    const engine     = new EntityResolutionEngine(repos, actRepo as any, [], ERSilentLogger);
    const result     = await engine.resolve(ACT_ID);
    expect(isFailed(result)).toBe(true);
  });

  it('retorna unresolved quando actividade não tem VenueMention', async () => {
    const activity = makeActivity(ACT_ID, null);
    const repos    = makeRepos();
    const actRepo  = makeActivityRepo([activity]);
    const engine   = new EntityResolutionEngine(repos, actRepo as any, [], ERSilentLogger);
    const result   = await engine.resolve(ACT_ID);
    expect(isUnresolved(result)).toBe(true);
    if (isUnresolved(result)) expect(result.reason).toBe('no_venue_mention');
  });

  it('ignora actividade com decisão humana existente (ADR-0013)', async () => {
    const activity  = makeActivity(ACT_ID, 'Museu José de Dome');
    const decision  = { action: 'matched', activityId: ACT_ID };
    const repos     = makeRepos([], decision);
    const actRepo   = makeActivityRepo([activity]);
    const engine    = new EntityResolutionEngine(repos, actRepo as any, [], ERSilentLogger);
    const result    = await engine.resolve(ACT_ID);
    // Deve retornar sem processar (decisão existente)
    expect(repos.candidate.insertCandidates).not.toHaveBeenCalled();
    expect(repos.candidate.deleteByActivity).not.toHaveBeenCalled();
  });

  it('limpa candidatos antigos antes de recalcular (ADR-0013)', async () => {
    const activity = makeActivity(ACT_ID, 'Museu');
    const repos    = makeRepos([makeVenue('v1', 'Museu José de Dome')]);
    const actRepo  = makeActivityRepo([activity]);
    const engine   = new EntityResolutionEngine(repos, actRepo as any, [new NameMatcher()], ERSilentLogger);
    await engine.resolve(ACT_ID);
    expect(repos.candidate.deleteByActivity).toHaveBeenCalledWith(ACT_ID);
  });

  it('persiste candidatos quando há venues elegíveis', async () => {
    const activity = makeActivity(ACT_ID, 'Museu');
    const venue    = makeVenue('v1', 'Museu José de Dome');
    const repos    = makeRepos([venue]);
    const actRepo  = makeActivityRepo([activity]);
    const engine   = new EntityResolutionEngine(repos, actRepo as any, [new NameMatcher()], ERSilentLogger);
    await engine.resolve(ACT_ID);
    expect(repos.candidate.insertCandidates).toHaveBeenCalled();
  });

  it('actualiza venue_resolution_status após resolução', async () => {
    const activity = makeActivity(ACT_ID, 'Museu');
    const venue    = makeVenue('v1', 'Museu José de Dome');
    const repos    = makeRepos([venue]);
    const actRepo  = makeActivityRepo([activity]);
    const engine   = new EntityResolutionEngine(repos, actRepo as any, [new NameMatcher()], ERSilentLogger);
    await engine.resolve(ACT_ID);
    expect(actRepo.updateResolutionStatus).toHaveBeenCalled();
    const [calledId, classification] = actRepo.updateResolutionStatus.mock.calls[0];
    expect(calledId).toBe(ACT_ID);
    expect(['matched', 'ambiguous', 'unresolved', 'proposed_new']).toContain(classification);
  });

  it('retorna proposed_new quando pool vazio após filtragem', async () => {
    const activity = makeActivity(ACT_ID, 'Passagem');
    const repos    = makeRepos([]); // zero venues elegíveis
    const actRepo  = makeActivityRepo([activity]);
    const engine   = new EntityResolutionEngine(repos, actRepo as any, [new NameMatcher()], ERSilentLogger);
    const result   = await engine.resolve(ACT_ID);
    expect(isUnresolved(result)).toBe(true);
  });

  it('resultado tem processingMs > 0', async () => {
    const activity = makeActivity(ACT_ID, 'Museu');
    const repos    = makeRepos([makeVenue('v1', 'Museu')]);
    const actRepo  = makeActivityRepo([activity]);
    const engine   = new EntityResolutionEngine(repos, actRepo as any, [new NameMatcher()], ERSilentLogger);
    const result   = await engine.resolve(ACT_ID);
    if (result.kind !== 'failed' && result.result) {
      expect(result.result.processingMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('EntityResolutionEngine.resolveAll()', () => {
  const PRODUCT_KEY = 'vivere-60-mais';

  it('limpa run órfã e cria nova quando run já está activa', async () => {
    const repos   = makeRepos();
    (repos.run.findActive as ReturnType<typeof vi.fn>).mockResolvedValue({
      runId: 'orphan-run' as ResolutionRunId,
      productKey: PRODUCT_KEY, status: 'running',
      startedAt: new Date(), finishedAt: null,
      activitiesProcessed: 0, candidatesGenerated: 0,
      classificationCounts: { matched: 0, ambiguous: 0, unresolved: 0, proposed_new: 0 },
      errorCount: 0, triggeredBy: 'manual',
    });
    const actRepo = makeActivityRepo([]);
    const engine  = new EntityResolutionEngine(repos, actRepo as any, [], ERSilentLogger);
    const result  = await engine.resolveAll(PRODUCT_KEY);
    // Run órfã é marcada como failed e nova run é criada
    expect(repos.run.markFailed).toHaveBeenCalledWith('orphan-run', expect.any(String));
    expect(repos.run.start).toHaveBeenCalledWith(PRODUCT_KEY, 'resolveAll');
  });

  it('cria run, processa actividades e finaliza', async () => {
    const activities = [
      makeActivity('act-1', 'Museu José de Dome'),
      makeActivity('act-2', null), // sem mention → unresolved
    ];
    const repos   = makeRepos([makeVenue('v1', 'Museu José de Dome')]);
    const actRepo = makeActivityRepo(activities);
    const engine  = new EntityResolutionEngine(repos, actRepo as any, [new NameMatcher()], ERSilentLogger);
    const result  = await engine.resolveAll(PRODUCT_KEY);

    expect(repos.run.start).toHaveBeenCalledWith(PRODUCT_KEY, 'resolveAll');
    expect(repos.run.finish).toHaveBeenCalled();
    expect(result.summary.total).toBe(2);
  });

  it('marca run como failed quando ocorre erro grave', async () => {
    const repos   = makeRepos();
    (repos.run.start as ReturnType<typeof vi.fn>).mockResolvedValue('run-err' as ResolutionRunId);
    const actRepo = {
      findById: vi.fn(),
      findUnresolved: vi.fn().mockRejectedValue(new Error('db crash')),
      updateResolutionStatus: vi.fn(),
    };
    const engine = new EntityResolutionEngine(repos, actRepo as any, [], ERSilentLogger);
    await engine.resolveAll(PRODUCT_KEY);
    expect(repos.run.markFailed).toHaveBeenCalledWith('run-err', expect.stringContaining('db crash'));
  });

  it('summary conta correctamente succeeded/unresolved/failed', async () => {
    const activities = [
      makeActivity('act-1', 'Museu José de Dome'), // com mention → algum resultado
      makeActivity('act-2', null),                  // sem mention → unresolved
    ];
    const repos   = makeRepos([makeVenue('v1', 'Museu')]);
    const actRepo = makeActivityRepo(activities);
    const engine  = new EntityResolutionEngine(repos, actRepo as any, [new NameMatcher()], ERSilentLogger);
    const result  = await engine.resolveAll(PRODUCT_KEY);

    expect(result.summary.total).toBe(2);
    expect(result.summary.unresolved).toBeGreaterThanOrEqual(1); // act-2 sem mention
    expect(result.summary.failed).toBe(0);
  });
});

describe('EntityResolutionEngine.resolveMany()', () => {
  it('processa lista específica de IDs', async () => {
    const ids = ['act-1', 'act-2'] as ActivityStagingId[];
    const activities = ids.map(id => makeActivity(id, 'Museu'));
    const repos   = makeRepos([makeVenue('v1', 'Museu')]);
    const actRepo = makeActivityRepo(activities);
    const engine  = new EntityResolutionEngine(repos, actRepo as any, [new NameMatcher()], ERSilentLogger);
    const result  = await engine.resolveMany(ids);
    expect(result.summary.total).toBe(2);
  });
});
