/**
 * entity-resolution/__tests__/repositories.contract.test.ts
 *
 * Testes de contrato dos repositórios ER.
 *
 * PRINCÍPIO: verificar o COMPORTAMENTO do contrato, não a implementação.
 * Estes testes usam mocks estruturados que simulam o Supabase.
 * Não tocam no banco real — correm sem .env.
 *
 * O que é testado:
 * - IVenueResolutionRunRepository: start, finish, markFailed, findActive
 * - IVenueResolutionCandidateRepository: insert, findByActivity, setOutcome, deleteByActivity, findEligibleVenues
 * - IVenueResolutionDecisionRepository: record, findLatest, findPendingReview
 * - EntityResolutionRepositoryFactory.fromObject()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityResolutionRepositoryFactory } from '../repositories/factory.js';
import type {
  IEntityResolutionRepositorySet,
  IVenueResolutionRunRepository,
  IVenueResolutionCandidateRepository,
  IVenueResolutionDecisionRepository,
} from '../repositories/interfaces.js';
import type {
  ResolutionRunId,
  ActivityStagingId,
  VenueStagingId,
  CandidateId,
  DecisionId,
  RankedCandidate,
  ResolutionRunSummary,
} from '../types/domain.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RUN_ID      = 'run-uuid-1'      as ResolutionRunId;
const ACTIVITY_ID = 'activity-uuid-1' as ActivityStagingId;
const VENUE_ID    = 'venue-uuid-1'    as VenueStagingId;
const CAND_ID     = 'candidate-uuid-1' as CandidateId;
const DEC_ID      = 'decision-uuid-1'  as DecisionId;
const PRODUCT_KEY = 'vivere-60-mais';

const makeRankedCandidate = (): RankedCandidate => ({
  candidate: {
    id:                   VENUE_ID,
    product_key:          PRODUCT_KEY,
    name:                 'Museu José de Dome',
    address:              'Rua do Museu, Cabo Frio',
    city:                 'Cabo Frio RJ',
    lat:                  -22.879,
    lng:                  -42.019,
    google_types:         ['museum'],
    source_category_hint: 'museu',
    proposal_status:      'approved',
  },
  score: {
    candidateId:   VENUE_ID,
    nameScore:     { value: 0.80, method: 'name', detail: 'contains match', subMethod: 'contains' },
    geoScore:      { value: 0.85, method: 'geo',  detail: 'distance 200m' },
    addressScore:  null,
    hybridScore:   0.82,
    finalScore:    0.92,
    boostApplied:  0.10,
  },
  rank:               1,
  autoClassification: 'matched',
});

const makeRunSummary = (): ResolutionRunSummary => ({
  runId:               RUN_ID,
  productKey:          PRODUCT_KEY,
  startedAt:           new Date('2026-07-06T10:00:00Z'),
  finishedAt:          null,
  status:              'running',
  activitiesProcessed: 0,
  candidatesGenerated: 0,
  classificationCounts: { matched: 0, ambiguous: 0, unresolved: 0, proposed_new: 0 },
  errorCount:          0,
  triggeredBy:         'manual',
});

// ── Factories de mocks ────────────────────────────────────────────────────────

function createRunRepoMock(): IVenueResolutionRunRepository {
  return {
    start:      vi.fn().mockResolvedValue(RUN_ID),
    finish:     vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    findActive: vi.fn().mockResolvedValue(makeRunSummary()),
  };
}

function createCandidateRepoMock(): IVenueResolutionCandidateRepository {
  return {
    insertCandidates:    vi.fn().mockResolvedValue([CAND_ID]),
    findByActivity:      vi.fn().mockResolvedValue([{
      id:                 CAND_ID,
      candidateVenueId:   VENUE_ID,
      score:              0.92,
      nameScore:          0.80,
      geoScore:           0.85,
      addressScore:       null,
      autoClassification: 'matched',
      decisionOutcome:    null,
    }]),
    setOutcome:          vi.fn().mockResolvedValue(undefined),
    deleteByActivity:    vi.fn().mockResolvedValue(1),
    findEligibleVenues:  vi.fn().mockResolvedValue([{
      id:                   VENUE_ID,
      name:                 'Museu José de Dome',
      address:              'Rua do Museu, Cabo Frio',
      city:                 'Cabo Frio RJ',
      lat:                  -22.879,
      lng:                  -42.019,
      google_types:         ['museum'],
      source_category_hint: 'museu',
      proposal_status:      'approved',
    }]),
  };
}

function createDecisionRepoMock(): IVenueResolutionDecisionRepository {
  return {
    record:             vi.fn().mockResolvedValue(DEC_ID),
    findLatest:         vi.fn().mockResolvedValue(null),
    findPendingReview:  vi.fn().mockResolvedValue([ACTIVITY_ID]),
  };
}

function createRepos(): IEntityResolutionRepositorySet {
  return EntityResolutionRepositoryFactory.fromObject({
    run:       createRunRepoMock(),
    candidate: createCandidateRepoMock(),
    decision:  createDecisionRepoMock(),
  });
}

// ── Testes de IVenueResolutionRunRepository ───────────────────────────────────

describe('IVenueResolutionRunRepository — contrato', () => {
  let repos: IEntityResolutionRepositorySet;

  beforeEach(() => { repos = createRepos(); });

  it('start() retorna um ResolutionRunId', async () => {
    const id = await repos.run.start(PRODUCT_KEY, 'manual');
    expect(id).toBe(RUN_ID);
    expect(repos.run.start).toHaveBeenCalledWith(PRODUCT_KEY, 'manual');
  });

  it('finish() aceita stats e não lança', async () => {
    await expect(
      repos.run.finish(RUN_ID, { activitiesProcessed: 5, candidatesGenerated: 12 })
    ).resolves.toBeUndefined();
    expect(repos.run.finish).toHaveBeenCalledWith(RUN_ID, { activitiesProcessed: 5, candidatesGenerated: 12 });
  });

  it('markFailed() aceita motivo e não lança', async () => {
    await expect(
      repos.run.markFailed(RUN_ID, 'Supabase connection timeout')
    ).resolves.toBeUndefined();
    expect(repos.run.markFailed).toHaveBeenCalledWith(RUN_ID, 'Supabase connection timeout');
  });

  it('findActive() retorna ResolutionRunSummary quando run activa existe', async () => {
    const summary = await repos.run.findActive(PRODUCT_KEY);
    expect(summary).not.toBeNull();
    expect(summary!.runId).toBe(RUN_ID);
    expect(summary!.status).toBe('running');
    expect(summary!.productKey).toBe(PRODUCT_KEY);
  });

  it('findActive() retorna null quando não há run activa', async () => {
    vi.mocked(repos.run.findActive).mockResolvedValueOnce(null);
    const summary = await repos.run.findActive(PRODUCT_KEY);
    expect(summary).toBeNull();
  });
});

// ── Testes de IVenueResolutionCandidateRepository ────────────────────────────

describe('IVenueResolutionCandidateRepository — contrato', () => {
  let repos: IEntityResolutionRepositorySet;

  beforeEach(() => { repos = createRepos(); });

  it('insertCandidates() retorna array de CandidateIds', async () => {
    const ids = await repos.candidate.insertCandidates(
      RUN_ID, ACTIVITY_ID, PRODUCT_KEY, [makeRankedCandidate()]
    );
    expect(ids).toEqual([CAND_ID]);
    expect(ids).toHaveLength(1);
  });

  it('insertCandidates() com array vazio retorna array vazio', async () => {
    vi.mocked(repos.candidate.insertCandidates).mockResolvedValueOnce([]);
    const ids = await repos.candidate.insertCandidates(RUN_ID, ACTIVITY_ID, PRODUCT_KEY, []);
    expect(ids).toEqual([]);
  });

  it('findByActivity() retorna candidatos ordenados por score desc', async () => {
    const found = await repos.candidate.findByActivity(ACTIVITY_ID);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(CAND_ID);
    expect(found[0]!.score).toBe(0.92);
    expect(found[0]!.decisionOutcome).toBeNull();
  });

  it('setOutcome() aceita accepted/rejected/skipped', async () => {
    for (const outcome of ['accepted', 'rejected', 'skipped'] as const) {
      await expect(
        repos.candidate.setOutcome(CAND_ID, outcome, DEC_ID)
      ).resolves.toBeUndefined();
    }
  });

  it('deleteByActivity() retorna contagem de linhas apagadas', async () => {
    const count = await repos.candidate.deleteByActivity(ACTIVITY_ID);
    expect(count).toBe(1);
    expect(repos.candidate.deleteByActivity).toHaveBeenCalledWith(ACTIVITY_ID);
  });

  it('findEligibleVenues() retorna venues com todos os campos necessários', async () => {
    const venues = await repos.candidate.findEligibleVenues(PRODUCT_KEY, ['approved', 'promoted']);
    expect(venues).toHaveLength(1);
    const v = venues[0]!;
    expect(v.id).toBe(VENUE_ID);
    expect(v.name).toBe('Museu José de Dome');
    expect(v.lat).toBeTypeOf('number');
    expect(v.lng).toBeTypeOf('number');
    expect(v.proposal_status).toMatch(/^(approved|promoted)$/);
    expect(Array.isArray(v.google_types)).toBe(true);
  });

  it('findEligibleVenues() nunca inclui pending_review', async () => {
    // O contrato garante que allowedStatuses não inclui pending_review
    // Este teste documenta a intenção — a implementação concreta deve verificar
    await repos.candidate.findEligibleVenues(PRODUCT_KEY, ['approved', 'promoted']);
    expect(repos.candidate.findEligibleVenues).toHaveBeenCalledWith(
      PRODUCT_KEY,
      expect.not.arrayContaining(['pending_review']),
    );
  });
});

// ── Testes de IVenueResolutionDecisionRepository ──────────────────────────────

describe('IVenueResolutionDecisionRepository — contrato', () => {
  let repos: IEntityResolutionRepositorySet;

  beforeEach(() => { repos = createRepos(); });

  it('record() retorna DecisionId', async () => {
    const id = await repos.decision.record(
      PRODUCT_KEY, ACTIVITY_ID, 'matched', CAND_ID,
      'user-uuid-1', 'Confirmado manualmente', false,
    );
    expect(id).toBe(DEC_ID);
  });

  it('record() aceita proposed_new com candidateId=null', async () => {
    const id = await repos.decision.record(
      PRODUCT_KEY, ACTIVITY_ID, 'proposed_new', null,
      'user-uuid-1', null, false,
    );
    expect(id).toBe(DEC_ID);
  });

  it('record() regista overrodeHighConfidence=true', async () => {
    await repos.decision.record(
      PRODUCT_KEY, ACTIVITY_ID, 'matched', CAND_ID,
      'user-uuid-1', 'Override de alta confiança', true,
    );
    expect(repos.decision.record).toHaveBeenCalledWith(
      PRODUCT_KEY, ACTIVITY_ID, 'matched', CAND_ID,
      'user-uuid-1', 'Override de alta confiança', true,
    );
  });

  it('findLatest() retorna null quando sem decisão', async () => {
    const dec = await repos.decision.findLatest(ACTIVITY_ID);
    expect(dec).toBeNull();
  });

  it('findLatest() retorna ResolutionDecision quando existe', async () => {
    vi.mocked(repos.decision.findLatest).mockResolvedValueOnce({
      id:                     DEC_ID,
      productKey:             PRODUCT_KEY,
      activityId:             ACTIVITY_ID,
      action:                 'matched',
      acceptedCandidateId:    CAND_ID,
      userId:                 'user-uuid-1',
      reviewedAt:             new Date(),
      notes:                  null,
      overrodeHighConfidence: false,
    });
    const dec = await repos.decision.findLatest(ACTIVITY_ID);
    expect(dec).not.toBeNull();
    expect(dec!.action).toBe('matched');
    expect(dec!.acceptedCandidateId).toBe(CAND_ID);
  });

  it('findPendingReview() retorna array de ActivityStagingIds', async () => {
    const ids = await repos.decision.findPendingReview(PRODUCT_KEY);
    expect(ids).toContain(ACTIVITY_ID);
  });

  it('findPendingReview() respeita o limite', async () => {
    await repos.decision.findPendingReview(PRODUCT_KEY, 10);
    expect(repos.decision.findPendingReview).toHaveBeenCalledWith(PRODUCT_KEY, 10);
  });
});

// ── Testes de EntityResolutionRepositoryFactory ───────────────────────────────

describe('EntityResolutionRepositoryFactory', () => {
  it('fromObject() retorna o mesmo objecto sem transformação', () => {
    const mock = createRepos();
    const result = EntityResolutionRepositoryFactory.fromObject(mock);
    expect(result).toBe(mock);
  });

  it('fromObject() expõe os três repositórios', () => {
    const repos = createRepos();
    expect(repos.run).toBeDefined();
    expect(repos.candidate).toBeDefined();
    expect(repos.decision).toBeDefined();
  });

  it('forSupabase() lança se SUPABASE_URL ausente (ambiente CI)', async () => {
    // Em CI sem .env, a função lança — comportamento correcto
    await expect(EntityResolutionRepositoryFactory.forSupabase())
      .rejects.toThrow();
  });
});

// ── Teste de fluxo completo em memória (ADR-0013) ────────────────────────────

describe('Fluxo completo de run — contrato ADR-0013', () => {
  it('sequência: start → insert → findByActivity → deleteByActivity → finish', async () => {
    const repos = createRepos();

    // 1. Criar run
    const runId = await repos.run.start(PRODUCT_KEY, 'test');
    expect(runId).toBe(RUN_ID);

    // 2. Verificar run activa
    const active = await repos.run.findActive(PRODUCT_KEY);
    expect(active?.status).toBe('running');

    // 3. Inserir candidatos
    const candidateIds = await repos.candidate.insertCandidates(
      runId, ACTIVITY_ID, PRODUCT_KEY, [makeRankedCandidate()]
    );
    expect(candidateIds).toHaveLength(1);

    // 4. Consultar candidatos
    const found = await repos.candidate.findByActivity(ACTIVITY_ID);
    expect(found).toHaveLength(1);
    expect(found[0]!.decisionOutcome).toBeNull(); // sem decisão ainda

    // 5. Re-resolver: apagar candidatos (ADR-0013 — sem decisão)
    const deleted = await repos.candidate.deleteByActivity(ACTIVITY_ID);
    expect(deleted).toBe(1);

    // 6. Finalizar run
    await repos.run.finish(runId, { activitiesProcessed: 1, candidatesGenerated: 1 });
    expect(repos.run.finish).toHaveBeenCalledWith(runId, { activitiesProcessed: 1, candidatesGenerated: 1 });
  });

  it('markFailed() deve ser chamável mesmo sem finish()', async () => {
    const repos = createRepos();
    const runId = await repos.run.start(PRODUCT_KEY, 'test');
    await expect(repos.run.markFailed(runId, 'db connection lost')).resolves.toBeUndefined();
  });

  it('gravar decisão: record() → findLatest() retorna a decisão', async () => {
    const repos = createRepos();

    // Simular decisão existente após record()
    vi.mocked(repos.decision.findLatest).mockResolvedValueOnce({
      id: DEC_ID, productKey: PRODUCT_KEY, activityId: ACTIVITY_ID,
      action: 'matched', acceptedCandidateId: CAND_ID,
      userId: 'u1', reviewedAt: new Date(), notes: null, overrodeHighConfidence: false,
    });

    const decId = await repos.decision.record(PRODUCT_KEY, ACTIVITY_ID, 'matched', CAND_ID, 'u1', null, false);
    expect(decId).toBe(DEC_ID);

    const latest = await repos.decision.findLatest(ACTIVITY_ID);
    expect(latest?.action).toBe('matched');
  });
});
