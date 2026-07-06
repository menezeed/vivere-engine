/**
 * entity-resolution/__tests__/kernel.test.ts
 *
 * Testes do Entity Resolution Kernel.
 *
 * Principio central desta suíte: ZERO dependências externas.
 * Sem Supabase, sem Hono, sem ficheiros .env, sem rede.
 * Pura lógica de tipos, configuração, erros e contratos.
 *
 * Se um teste aqui precisa de uma dependência externa,
 * está no ficheiro errado.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  // Configuração
  DEFAULT_ER_CONFIG,
  DEFAULT_CANDIDATE_SELECTION,
  DEFAULT_SCORING,
  DEFAULT_THRESHOLDS,
  validateERConfig,
  // Result Pattern
  success, partial, unresolved, failed,
  isSuccess, isPartial, isUnresolved, isFailed, hasResult,
  // Erros
  ERError,
  CandidateGenerationError,
  NoCandidateFoundError,
  MatcherConfigurationError,
  InvalidResolutionStateError,
  RunAlreadyActiveError,
  DecisionConflictError,
  RepositoryError,
  isERError,
  // Pipeline
  assertFilteredCandidates,
  assertScoredCandidates,
  classificationLabel,
  requiresReview,
  // Factory
  EntityResolutionRepositoryFactory,
} from '../index.js';

import type {
  ResolutionResult,
  FilteredCandidates,
  ScoredCandidates,
  IMatcher,
  VenueCandidate,
  MatchScore,
  ActivityStagingId,
  VenueStagingId,
  ResolutionRunId,
} from '../index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeActivityId = (n = 1) => `activity-${n}` as ActivityStagingId;

const makeCandidate = (overrides: Partial<VenueCandidate> = {}): VenueCandidate => ({
  id:                   'venue-1' as any,
  product_key:          'vivere-60-mais',
  name:                 'Museu José de Dome',
  address:              'Rua X, Centro, Cabo Frio - RJ',
  city:                 'Cabo Frio RJ',
  lat:                  -22.879,
  lng:                  -42.019,
  google_types:         ['museum', 'point_of_interest'],
  source_category_hint: 'museu',
  proposal_status:      'approved',
  ...overrides,
});

const makeResolutionResult = (overrides: Partial<ResolutionResult> = {}): ResolutionResult => ({
  activityId:          makeActivityId(),
  venueMention:        { raw_text: 'Museu José de Dome', raw_address_text: null, confidence_hint: 'explicit_name' },
  classification:      'matched',
  topCandidate:        null,
  allCandidates:       [],
  candidatesInPool:    10,
  candidatesFiltered:  3,
  processingMs:        42,
  runId:               'run-1' as ResolutionRunId,
  ...overrides,
});

// ── 1. Configuração ───────────────────────────────────────────────────────────

describe('EntityResolutionConfig', () => {
  describe('defaults', () => {
    it('DEFAULT_CANDIDATE_SELECTION tem valores correctos', () => {
      expect(DEFAULT_CANDIDATE_SELECTION.maxCandidates).toBe(50);
      expect(DEFAULT_CANDIDATE_SELECTION.maxRadiusMeters).toBe(5000);
      expect(DEFAULT_CANDIDATE_SELECTION.allowCrossCity).toBe(false);
      expect(DEFAULT_CANDIDATE_SELECTION.allowedVenueStatuses).toEqual(['approved', 'promoted']);
      expect(DEFAULT_CANDIDATE_SELECTION.categoryBoost).toBe(true);
    });

    it('DEFAULT_SCORING tem pesos que somam 1.0', () => {
      const { name, geo, address } = DEFAULT_SCORING.weights;
      expect(name + geo + address).toBeCloseTo(1.0, 3);
    });

    it('DEFAULT_THRESHOLDS tem highConfidence > minSuggestion', () => {
      expect(DEFAULT_THRESHOLDS.highConfidence).toBeGreaterThan(DEFAULT_THRESHOLDS.minSuggestion);
      expect(DEFAULT_THRESHOLDS.highConfidence).toBe(0.85);
      expect(DEFAULT_THRESHOLDS.minSuggestion).toBe(0.50);
    });

    it('DEFAULT_ER_CONFIG agrega os três defaults', () => {
      expect(DEFAULT_ER_CONFIG.selection).toBe(DEFAULT_CANDIDATE_SELECTION);
      expect(DEFAULT_ER_CONFIG.scoring).toBe(DEFAULT_SCORING);
      expect(DEFAULT_ER_CONFIG.thresholds).toBe(DEFAULT_THRESHOLDS);
    });
  });

  describe('validateERConfig', () => {
    it('aceita DEFAULT_ER_CONFIG sem lançar', () => {
      expect(() => validateERConfig(DEFAULT_ER_CONFIG)).not.toThrow();
    });

    it('lança quando pesos não somam 1.0', () => {
      const bad = { ...DEFAULT_ER_CONFIG, scoring: { ...DEFAULT_SCORING, weights: { name: 0.6, geo: 0.6, address: 0.1 } } };
      expect(() => validateERConfig(bad)).toThrow('Pesos devem somar 1.0');
    });

    it('lança quando highConfidence <= minSuggestion', () => {
      const bad = { ...DEFAULT_ER_CONFIG, thresholds: { highConfidence: 0.5, minSuggestion: 0.5 } };
      expect(() => validateERConfig(bad)).toThrow('maior que minSuggestion');
    });

    it('lança quando maxCandidates < 1', () => {
      const bad = { ...DEFAULT_ER_CONFIG, selection: { ...DEFAULT_CANDIDATE_SELECTION, maxCandidates: 0 } };
      expect(() => validateERConfig(bad)).toThrow('Deve ser ≥ 1');
    });

    it('lança quando allowedVenueStatuses está vazio', () => {
      const bad = { ...DEFAULT_ER_CONFIG, selection: { ...DEFAULT_CANDIDATE_SELECTION, allowedVenueStatuses: [] } };
      expect(() => validateERConfig(bad)).toThrow('não pode ser vazio');
    });

    it('lança quando threshold fora de [0, 1]', () => {
      const bad = { ...DEFAULT_ER_CONFIG, thresholds: { highConfidence: 1.5, minSuggestion: 0.5 } };
      expect(() => validateERConfig(bad)).toThrow('Deve estar em [0, 1]');
    });
  });
});

// ── 2. Result Pattern ─────────────────────────────────────────────────────────

describe('ERResult Pattern', () => {
  const result = makeResolutionResult();
  const err = new CandidateGenerationError('activity-1', 'db error');

  it('success() produz kind=success', () => {
    const r = success(result);
    expect(r.kind).toBe('success');
    expect(r.result).toBe(result);
  });

  it('partial() produz kind=partial com warnings', () => {
    const r = partial(result, ['GeoMatcher ignorado']);
    expect(r.kind).toBe('partial');
    expect(r.warnings).toContain('GeoMatcher ignorado');
  });

  it('unresolved() produz kind=unresolved com reason', () => {
    const r = unresolved(result, 'empty_pool');
    expect(r.kind).toBe('unresolved');
    expect(r.reason).toBe('empty_pool');
  });

  it('failed() produz kind=failed com error', () => {
    const r = failed(err);
    expect(r.kind).toBe('failed');
    expect(r.error).toBe(err);
    expect(r.partial).toBeUndefined();
  });

  it('failed() aceita resultado parcial opcional', () => {
    const r = failed(err, result);
    expect(r.partial).toBe(result);
  });

  describe('type guards', () => {
    it('isSuccess discrimina correctamente', () => {
      expect(isSuccess(success(result))).toBe(true);
      expect(isSuccess(failed(err))).toBe(false);
    });

    it('isPartial discrimina correctamente', () => {
      expect(isPartial(partial(result, []))).toBe(true);
      expect(isPartial(success(result))).toBe(false);
    });

    it('isUnresolved discrimina correctamente', () => {
      expect(isUnresolved(unresolved(result, 'empty_pool'))).toBe(true);
      expect(isUnresolved(success(result))).toBe(false);
    });

    it('isFailed discrimina correctamente', () => {
      expect(isFailed(failed(err))).toBe(true);
      expect(isFailed(success(result))).toBe(false);
    });

    it('hasResult é true para success, partial, unresolved', () => {
      expect(hasResult(success(result))).toBe(true);
      expect(hasResult(partial(result, []))).toBe(true);
      expect(hasResult(unresolved(result, 'empty_pool'))).toBe(true);
      expect(hasResult(failed(err))).toBe(false);
    });
  });
});

// ── 3. Erros ──────────────────────────────────────────────────────────────────

describe('ERError hierarquia', () => {
  it('todos os erros são instanceof ERError', () => {
    const errors = [
      new CandidateGenerationError('a1', 'cause'),
      new NoCandidateFoundError('a1', 10, 'raio'),
      new MatcherConfigurationError('comp', 'field', 42, 'reason'),
      new InvalidResolutionStateError('a1', 'matched', 'resolve'),
      new RunAlreadyActiveError('vivere-60-mais', 'run-1'),
      new DecisionConflictError('a1', 'dec-1'),
      new RepositoryError('insert', 'venue_resolution_runs', 'db error'),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(ERError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('cada erro tem código único', () => {
    const codes = [
      new CandidateGenerationError('a', 'x').code,
      new NoCandidateFoundError('a', 0, 'x').code,
      new MatcherConfigurationError('c', 'f', 0, 'r').code,
      new InvalidResolutionStateError('a', 's', 'act').code,
      new RunAlreadyActiveError('p', 'r').code,
      new DecisionConflictError('a', 'd').code,
      new RepositoryError('op', 'table', 'err').code,
    ];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it('isERError detecta correctamente', () => {
    expect(isERError(new CandidateGenerationError('a', 'x'))).toBe(true);
    expect(isERError(new Error('generic'))).toBe(false);
    expect(isERError('string')).toBe(false);
    expect(isERError(null)).toBe(false);
  });

  it('erros incluem contexto estruturado', () => {
    const err = new CandidateGenerationError('activity-42', 'connection timeout');
    expect(err.context.activityId).toBe('activity-42');
    expect(String(err.context.cause)).toContain('connection timeout');
  });

  it('MatcherConfigurationError inclui componente e campo', () => {
    const err = new MatcherConfigurationError('HybridScoreCalculator', 'weights.name', 1.5, 'fora de [0,1]');
    expect(err.context.component).toBe('HybridScoreCalculator');
    expect(err.context.field).toBe('weights.name');
    expect(err.message).toContain('fora de [0,1]');
  });
});

// ── 4. Pipeline Contracts ─────────────────────────────────────────────────────

describe('Pipeline Contracts', () => {
  const activityId = makeActivityId();
  const candidate  = makeCandidate();

  const makePool = (n: number) => ({
    activityId,
    venueMention: null,
    productKey:   'vivere-60-mais',
    candidates:   Array.from({ length: n }, (_, i) => makeCandidate({ id: `venue-${i}` as any })),
    generatedAt:  Date.now(),
  });

  const makeFiltered = (candidates: VenueCandidate[], original: number): FilteredCandidates => ({
    activityId,
    venueMention:     null,
    candidates,
    filteredCount:    original - candidates.length,
    originalCount:    original,
    filterReasoning:  `${candidates.length} de ${original} após raio`,
  });

  describe('assertFilteredCandidates', () => {
    it('não lança quando dentro do limite', () => {
      const filtered = makeFiltered([candidate], 10);
      expect(() => assertFilteredCandidates(filtered, 50)).not.toThrow();
    });

    it('lança quando excede maxCandidates', () => {
      const filtered = makeFiltered(Array.from({ length: 51 }, (_, i) => makeCandidate({ id: `v-${i}` as any })), 100);
      expect(() => assertFilteredCandidates(filtered, 50)).toThrow('Invariante violada');
    });

    it('lança quando filteredCount > originalCount', () => {
      const filtered = makeFiltered([candidate, makeCandidate({ id: 'v2' as any })], 1);
      expect(() => assertFilteredCandidates(filtered, 50)).toThrow('Invariante violada');
    });
  });

  describe('assertScoredCandidates', () => {
    it('não lança quando counts coincidem', () => {
      const filtered = makeFiltered([candidate], 5);
      const scored: ScoredCandidates = {
        activityId,
        venueMention: null,
        scores: [{
          candidateId:   candidate.id,
          nameScore:     null,
          geoScore:      null,
          addressScore:  null,
          hybridScore:   0.8,
          finalScore:    0.9,
          boostApplied:  0.1,
        }],
      };
      expect(() => assertScoredCandidates(filtered, scored)).not.toThrow();
    });

    it('lança quando counts diferem', () => {
      const filtered = makeFiltered([candidate, makeCandidate({ id: 'v2' as any })], 5);
      const scored: ScoredCandidates = {
        activityId,
        venueMention: null,
        scores: [{ candidateId: candidate.id, nameScore: null, geoScore: null, addressScore: null, hybridScore: 0.8, finalScore: 0.8, boostApplied: 0 }],
      };
      expect(() => assertScoredCandidates(filtered, scored)).toThrow('Invariante violada');
    });
  });

  describe('classificationLabel', () => {
    it('retorna label para cada classificação', () => {
      expect(classificationLabel('matched')).toContain('alta confiança');
      expect(classificationLabel('ambiguous')).toContain('revisão');
      expect(classificationLabel('unresolved')).toContain('não identificado');
      expect(classificationLabel('proposed_new')).toContain('novo');
    });
  });

  describe('requiresReview', () => {
    it('matched e ambiguous requerem revisão', () => {
      expect(requiresReview('matched')).toBe(true);
      expect(requiresReview('ambiguous')).toBe(true);
    });

    it('unresolved e proposed_new não requerem revisão imediata', () => {
      expect(requiresReview('unresolved')).toBe(false);
      expect(requiresReview('proposed_new')).toBe(false);
    });
  });
});

// ── 5. IMatcher — testabilidade sem banco ────────────────────────────────────

describe('IMatcher testabilidade', () => {
  // Demonstra que qualquer matcher pode ser testado com dados sintéticos.
  // Este teste usa um mock que simula o comportamento de um NameMatcher.

  const mockMatcher: IMatcher = {
    id: 'name',
    score(mention, candidate): MatchScore | null {
      if (!mention?.raw_text) return null;
      const sim = mention.raw_text.toLowerCase().includes(candidate.name.toLowerCase()) ? 0.8 : 0.3;
      return { value: sim, method: 'name', detail: `contains=${sim === 0.8}`, subMethod: 'contains' };
    },
  };

  const mention = { raw_text: 'Museu José de Dome', raw_address_text: null, confidence_hint: 'explicit_name' as const };
  const candidate = makeCandidate({ name: 'Museu José de Dome' });

  it('score retorna MatchScore sem qualquer dependência externa', () => {
    const result = mockMatcher.score(mention, candidate);
    expect(result).not.toBeNull();
    expect(result!.value).toBe(0.8);
    expect(result!.method).toBe('name');
  });

  it('score retorna null quando menção está vazia', () => {
    const emptyMention = { raw_text: '', raw_address_text: null, confidence_hint: 'explicit_name' as const };
    const result = mockMatcher.score(emptyMention, candidate);
    expect(result).toBeNull();
  });

  it('múltiplos matchers podem ser testados em isolamento', () => {
    const mockGeoMatcher: IMatcher = {
      id: 'geo',
      score(_mention, candidate): MatchScore | null {
        if (candidate.lat === null || candidate.lng === null) return null;
        return { value: 0.85, method: 'geo', detail: 'distance=250m' };
      },
    };

    const geoResult = mockGeoMatcher.score(mention, candidate);
    expect(geoResult!.value).toBe(0.85);
    expect(geoResult!.method).toBe('geo');

    // candidato sem coordenadas → null
    const noCoords = makeCandidate({ lat: null, lng: null });
    expect(mockGeoMatcher.score(mention, noCoords)).toBeNull();
  });
});

// ── 6. EntityResolutionRepositoryFactory ─────────────────────────────────────

describe('EntityResolutionRepositoryFactory', () => {
  it('fromObject retorna o mesmo objecto (sem transformação)', () => {
    const mockRepos = {
      run:       { start: vi.fn(), finish: vi.fn(), markFailed: vi.fn(), findActive: vi.fn() },
      candidate: { insertCandidates: vi.fn(), findByActivity: vi.fn(), setOutcome: vi.fn(), findEligibleVenues: vi.fn(), deleteByActivity: vi.fn() },
      decision:  { record: vi.fn(), findLatest: vi.fn(), findPendingReview: vi.fn() },
    };
    const repos = EntityResolutionRepositoryFactory.fromObject(mockRepos);
    expect(repos).toBe(mockRepos);
  });

  it('forSupabase lança antes das classes concretas existirem', async () => {
    // Em CI sem .env, lança por falta de SUPABASE_URL.
    // Em dev com .env, lança por falta de implementação (Sprint 7.4).
    // Em ambos os casos, lança — que é o comportamento correcto.
    await expect(EntityResolutionRepositoryFactory.forSupabase()).rejects.toThrow();
  });
});

// ── 7. Branded Types ──────────────────────────────────────────────────────────

describe('Branded types previnem confusão de IDs', () => {
  // Este teste verifica que os branded types funcionam correctamente em runtime.
  // Em compile-time, ActivityStagingId e VenueStagingId são tipos diferentes
  // e não podem ser atribuídos um ao outro.

  it('activityId e venueId têm o mesmo formato mas são semanticamente distintos', () => {
    const actId = 'activity-uuid-123' as ActivityStagingId;
    const venuId = 'venue-uuid-456' as VenueStagingId;

    // Em runtime são strings — o branded type é apenas compile-time
    expect(typeof actId).toBe('string');
    expect(typeof venuId).toBe('string');

    // Os valores são diferentes — IDs diferentes de entidades diferentes
    expect(actId).not.toBe(venuId);
  });
});
