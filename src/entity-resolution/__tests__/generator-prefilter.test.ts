/**
 * entity-resolution/__tests__/generator-prefilter.test.ts
 *
 * Testes do CandidateGenerator, CandidatePreFilter e pipeline completo em memória.
 * Zero dependências externas — todos os providers são mocks.
 */

import { describe, it, expect, vi } from 'vitest';
import { CandidateGenerator } from '../pipeline/CandidateGenerator.js';
import { CandidatePreFilter }  from '../pipeline/CandidatePreFilter.js';
import { HybridScoreCalculator } from '../pipeline/HybridScoreCalculator.js';
import { ThresholdClassifier, buildCandidateMap } from '../pipeline/ThresholdClassifier.js';
import { DEFAULT_CANDIDATE_SELECTION, DEFAULT_SCORING, DEFAULT_THRESHOLDS } from '../config/index.js';
import { NameMatcher } from '../matchers/NameMatcher.js';
import { createGeoMatcherWithReference } from '../matchers/GeoMatcher.js';
import { CandidateGenerationError } from '../errors/index.js';
import type {
  VenueCandidate,
  ActivityStagingId,
  VenueStagingId,
  ICandidateProvider,
  ResolutionContext,
} from '../index.js';
import type { VenueMention } from '../../types/RawActivityItem.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ACT_ID = 'activity-gen-001' as ActivityStagingId;
const PRODUCT_KEY = 'vivere-60-mais';

function mention(text: string, hint: VenueMention['confidence_hint'] = 'explicit_name'): VenueMention {
  return { raw_text: text, raw_address_text: null, confidence_hint: hint };
}

function makeCandidate(id: string, name: string, overrides: Partial<VenueCandidate> = {}): VenueCandidate {
  return {
    id:                   id as VenueStagingId,
    product_key:          PRODUCT_KEY,
    name,
    address:              null,
    city:                 'Cabo Frio RJ',
    lat:                  -22.879,
    lng:                  -42.019,
    google_types:         [],
    source_category_hint: null,
    proposal_status:      'approved',
    ...overrides,
  };
}

/** Provider mock que retorna uma lista fixa de candidatos. */
function mockProvider(candidates: VenueCandidate[]): ICandidateProvider<VenueCandidate> {
  return {
    id: 'mock-provider',
    provide: vi.fn().mockResolvedValue(candidates),
  };
}

/** Provider mock que lança um erro. */
function failingProvider(error = 'db error'): ICandidateProvider<VenueCandidate> {
  return {
    id: 'failing-provider',
    provide: vi.fn().mockRejectedValue(new Error(error)),
  };
}

// Venues reais de Cabo Frio para testes de raio
const VENUES_CABO_FRIO = [
  makeCandidate('praia-forte',  'Praia do Forte',         { lat: -22.875, lng: -42.008, city: 'Cabo Frio RJ' }),
  makeCandidate('forte-mat',    'Forte São Mateus',        { lat: -22.877, lng: -42.007, city: 'Cabo Frio RJ' }),
  makeCandidate('museu-dome',   'Museu José de Dome',      { lat: -22.879, lng: -42.019, city: 'Cabo Frio RJ' }),
];

const VENUE_SAO_PEDRO = makeCandidate('academia-viva', 'Academia Viva 100%', {
  lat: -22.840, lng: -42.070, city: 'São Pedro da Aldeia RJ',
});

const VENUE_IGUABA = makeCandidate('academia-nitro', 'Academia nitro gym', {
  lat: -22.847, lng: -42.229, city: 'Iguaba Grande RJ',
});

// ── 1. CandidateGenerator ────────────────────────────────────────────────────

describe('CandidateGenerator', () => {
  it('retorna CandidatePool com todos os candidatos do provider', async () => {
    const candidates = [makeCandidate('v1', 'Venue A'), makeCandidate('v2', 'Venue B')];
    const gen = new CandidateGenerator(mockProvider(candidates));
    const pool = await gen.generate(ACT_ID, mention('Venue'), PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION);

    expect(pool.activityId).toBe(ACT_ID);
    expect(pool.productKey).toBe(PRODUCT_KEY);
    expect(pool.candidates).toHaveLength(2);
    expect(pool.generatedAt).toBeGreaterThan(0);
  });

  it('preserva VenueMention no pool', async () => {
    const men = mention('Praia do Forte');
    const gen = new CandidateGenerator(mockProvider([]));
    const pool = await gen.generate(ACT_ID, men, PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION);
    expect(pool.venueMention).toBe(men);
  });

  it('pool vazio quando provider retorna array vazio', async () => {
    const gen = new CandidateGenerator(mockProvider([]));
    const pool = await gen.generate(ACT_ID, null, PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION);
    expect(pool.candidates).toHaveLength(0);
  });

  it('VenueMention null é preservado', async () => {
    const gen = new CandidateGenerator(mockProvider([]));
    const pool = await gen.generate(ACT_ID, null, PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION);
    expect(pool.venueMention).toBeNull();
  });

  it('passa ResolutionContext correcto para o provider', async () => {
    const provider = mockProvider([]);
    const gen = new CandidateGenerator(provider);
    await gen.generate(ACT_ID, null, PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION);

    const ctx: ResolutionContext = (provider.provide as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ctx.activityId).toBe(ACT_ID);
    expect(ctx.productKey).toBe(PRODUCT_KEY);
    expect(ctx.config).toBe(DEFAULT_CANDIDATE_SELECTION);
  });

  it('lança CandidateGenerationError quando provider falha', async () => {
    const gen = new CandidateGenerator(failingProvider('connection lost'));
    await expect(
      gen.generate(ACT_ID, null, PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION),
    ).rejects.toBeInstanceOf(CandidateGenerationError);
  });

  it('CandidateGenerationError inclui activityId no contexto', async () => {
    const gen = new CandidateGenerator(failingProvider());
    try {
      await gen.generate(ACT_ID, null, PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION);
    } catch (e: any) {
      expect(e.context.activityId).toBe(ACT_ID);
    }
  });
});

// ── 2. CandidatePreFilter ────────────────────────────────────────────────────

describe('CandidatePreFilter', () => {
  const filter = new CandidatePreFilter();

  function makePool(candidates: VenueCandidate[], men: VenueMention | null = null) {
    return {
      activityId:   ACT_ID,
      venueMention: men,
      productKey:   PRODUCT_KEY,
      candidates,
      generatedAt:  Date.now(),
    };
  }

  it('pool vazio → FilteredCandidates vazio', () => {
    const result = filter.filter(makePool([]), DEFAULT_CANDIDATE_SELECTION);
    expect(result.candidates).toHaveLength(0);
    expect(result.originalCount).toBe(0);
  });

  it('preserva todos os candidatos quando nenhum filtro elimina', () => {
    const candidates = VENUES_CABO_FRIO; // todos da mesma cidade
    const result = filter.filter(makePool(candidates), DEFAULT_CANDIDATE_SELECTION);
    expect(result.candidates).toHaveLength(3);
    expect(result.filteredCount).toBe(0);
  });

  it('filtro por cidade — elimina candidatos de outra cidade', () => {
    const mixed = [...VENUES_CABO_FRIO, VENUE_SAO_PEDRO, VENUE_IGUABA];
    const result = filter.filter(makePool(mixed), {
      ...DEFAULT_CANDIDATE_SELECTION,
      allowCrossCity: false,
    });
    // A cidade mais frequente é 'Cabo Frio RJ' (3 venues vs 1 cada das outras)
    expect(result.candidates.every(c => c.city === 'Cabo Frio RJ')).toBe(true);
    expect(result.candidates).toHaveLength(3);
  });

  it('allowCrossCity=true mantém candidatos de todas as cidades', () => {
    const mixed = [...VENUES_CABO_FRIO, VENUE_SAO_PEDRO, VENUE_IGUABA];
    const result = filter.filter(makePool(mixed), {
      ...DEFAULT_CANDIDATE_SELECTION,
      allowCrossCity:  true,
      maxRadiusMeters: 100_000, // raio grande para não eliminar por distância
    });
    expect(result.candidates).toHaveLength(5);
  });

  it('candidato sem city não é eliminado pelo filtro de cidade', () => {
    const semCity = makeCandidate('sem-city', 'Venue sem cidade', { city: null });
    const pool    = makePool([...VENUES_CABO_FRIO, semCity]);
    const result  = filter.filter(pool, { ...DEFAULT_CANDIDATE_SELECTION, allowCrossCity: false });
    // Venue sem city passa — não temos informação para eliminar
    const ids = result.candidates.map(c => c.id);
    expect(ids).toContain('sem-city');
  });

  it('filtro por raio — elimina candidatos além do maxRadiusMeters', () => {
    // Centro de Cabo Frio: -22.88, -42.02
    // São Pedro (~9km) e Iguaba (~18km) — ambos além de 5km
    const all = [...VENUES_CABO_FRIO, VENUE_SAO_PEDRO, VENUE_IGUABA];
    const result = filter.filter(makePool(all), {
      ...DEFAULT_CANDIDATE_SELECTION,
      allowCrossCity:  true,   // não filtrar por cidade, só por raio
      maxRadiusMeters: 5000,
    });
    // São Pedro e Iguaba estão além de 5km do centroide de Cabo Frio
    // Os 3 venues de Cabo Frio estão < 5km
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('candidato sem coordenadas não é eliminado pelo filtro de raio', () => {
    const semCoords = makeCandidate('sem-coords', 'Venue sem coords', { lat: null, lng: null, city: 'Cabo Frio RJ' });
    const pool = makePool([...VENUES_CABO_FRIO, semCoords]);
    const result = filter.filter(pool, { ...DEFAULT_CANDIDATE_SELECTION, maxRadiusMeters: 100 });
    // Venue sem coords não pode ser eliminado por raio — passa sempre
    const ids = result.candidates.map(c => c.id as string);
    expect(ids).toContain('sem-coords');
  });

  it('maxCandidates limita o número de candidatos', () => {
    const muitos = Array.from({ length: 10 }, (_, i) =>
      makeCandidate(`v${i}`, `Venue ${i}`, { city: 'Cabo Frio RJ' }),
    );
    const result = filter.filter(makePool(muitos), {
      ...DEFAULT_CANDIDATE_SELECTION,
      maxCandidates: 3,
    });
    expect(result.candidates).toHaveLength(3);
    expect(result.filteredCount).toBe(7);
  });

  it('filterReasoning descreve o que aconteceu', () => {
    const result = filter.filter(makePool(VENUES_CABO_FRIO), DEFAULT_CANDIDATE_SELECTION);
    expect(result.filterReasoning).toBeTruthy();
    expect(typeof result.filterReasoning).toBe('string');
  });

  it('originalCount reflecte o pool original, não o filtrado', () => {
    const mixed = [...VENUES_CABO_FRIO, VENUE_SAO_PEDRO];
    const result = filter.filter(makePool(mixed), DEFAULT_CANDIDATE_SELECTION);
    expect(result.originalCount).toBe(4);
  });

  it('activityId e venueMention preservados', () => {
    const men = mention('Praia do Forte');
    const result = filter.filter(
      { activityId: ACT_ID, venueMention: men, productKey: PRODUCT_KEY, candidates: [], generatedAt: 0 },
      DEFAULT_CANDIDATE_SELECTION,
    );
    expect(result.activityId).toBe(ACT_ID);
    expect(result.venueMention).toBe(men);
  });

  it('PreFilter não usa texto da menção para filtrar — sem inteligência semântica', () => {
    // Menção sobre "Museu" — mas o PreFilter não sabe disso
    // Todos os candidatos geográficos passam, independentemente do nome
    const men = mention('Museu José de Dome');
    const result = filter.filter(makePool(VENUES_CABO_FRIO, men), DEFAULT_CANDIDATE_SELECTION);
    // Praia do Forte e Forte São Mateus também passam — o PreFilter não filtra por nome
    expect(result.candidates.length).toBe(VENUES_CABO_FRIO.length);
  });

  it('top N ordena por proximidade geográfica quando corta', () => {
    // Criar venues a distâncias crescentes do centro de Cabo Frio
    const perto  = makeCandidate('perto',  'Venue Perto',  { lat: -22.880, lng: -42.019, city: 'Cabo Frio RJ' });
    const medio  = makeCandidate('medio',  'Venue Medio',  { lat: -22.883, lng: -42.022, city: 'Cabo Frio RJ' });
    const longe  = makeCandidate('longe',  'Venue Longe',  { lat: -22.890, lng: -42.030, city: 'Cabo Frio RJ' });
    const result = filter.filter(makePool([longe, medio, perto]), {
      ...DEFAULT_CANDIDATE_SELECTION,
      maxCandidates: 2,
    });
    // Os 2 mais próximos devem ser mantidos
    const ids = result.candidates.map(c => c.id as string);
    expect(ids).toContain('perto');
    expect(ids).toContain('medio');
    expect(ids).not.toContain('longe');
  });
});

// ── 3. Pipeline completo em memória ──────────────────────────────────────────

describe('Pipeline em memória: Generator → PreFilter → Matchers → Hybrid → Threshold', () => {
  it('pipeline completo com NameMatcher — Praia do Forte', async () => {
    const candidates = [
      makeCandidate('praia-forte', 'Praia do Forte',  { lat: -22.875, lng: -42.008, city: 'Cabo Frio RJ' }),
      makeCandidate('forte-mat',   'Forte São Mateus', { lat: -22.877, lng: -42.007, city: 'Cabo Frio RJ' }),
      makeCandidate('museu-dome',  'Museu José de Dome',{ lat: -22.879, lng: -42.019, city: 'Cabo Frio RJ' }),
    ];

    const generator  = new CandidateGenerator(mockProvider(candidates));
    const preFilter  = new CandidatePreFilter();
    const calculator = new HybridScoreCalculator();
    const thresholder= new ThresholdClassifier();
    const matchers   = [
      new NameMatcher(),
      createGeoMatcherWithReference({ lat: -22.8806, lng: -42.0187 }),
    ];

    const men    = mention('Praia do Forte');
    const pool   = await generator.generate(ACT_ID, men, PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION);
    const filtered = preFilter.filter(pool, DEFAULT_CANDIDATE_SELECTION);
    const scored   = calculator.calculate(filtered, matchers, DEFAULT_SCORING);
    const map      = buildCandidateMap(candidates);
    const ranked   = thresholder.classifyWithCandidates(scored, DEFAULT_THRESHOLDS, map);

    // "Praia do Forte" deve ter o score mais alto
    expect(ranked.ranked[0]!.candidate.name).toBe('Praia do Forte');
    expect(ranked.ranked[0]!.score.finalScore).toBeGreaterThan(ranked.ranked[1]!.score.finalScore);

    // Pipeline não usou banco, não usou Supabase, não usou Hono
    // Resultado completamente determinístico
    expect(['matched', 'ambiguous', 'unresolved']).toContain(ranked.classification);
  });

  it('pipeline com pool vazio → proposed_new', async () => {
    const generator  = new CandidateGenerator(mockProvider([]));
    const preFilter  = new CandidatePreFilter();
    const calculator = new HybridScoreCalculator();
    const thresholder= new ThresholdClassifier();

    const pool    = await generator.generate(ACT_ID, mention('Passagem'), PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION);
    const filtered = preFilter.filter(pool, DEFAULT_CANDIDATE_SELECTION);
    const scored   = calculator.calculate(filtered, [], DEFAULT_SCORING);
    const ranked   = thresholder.classify(scored, DEFAULT_THRESHOLDS);

    expect(ranked.classification).toBe('proposed_new');
    expect(ranked.ranked).toHaveLength(0);
  });

  it('PreFilter nunca usa o texto da menção — só reduz geograficamente', async () => {
    const candidates = VENUES_CABO_FRIO;
    const generator  = new CandidateGenerator(mockProvider(candidates));
    const preFilter  = new CandidatePreFilter();

    // Menção sobre "Museu" mas PreFilter não deve eliminar Praia do Forte
    const men    = mention('Museu José de Dome');
    const pool   = await generator.generate(ACT_ID, men, PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION);
    const filtered = preFilter.filter(pool, DEFAULT_CANDIDATE_SELECTION);

    // Todos os 3 venues de Cabo Frio passam — o PreFilter não filtra por nome
    expect(filtered.candidates).toHaveLength(3);

    // É o NameMatcher (nos Matchers) que vai dar score alto só ao Museu
    // PreFilter apenas garante que todos os candidatos geográficos chegam aos Matchers
  });

  it('pipeline é determinístico — mesma entrada, mesma saída', async () => {
    const candidates = [makeCandidate('v1', 'Museu José de Dome')];
    const men = mention('Museu José de Dome');

    async function runPipeline() {
      const generator   = new CandidateGenerator(mockProvider(candidates));
      const pool        = await generator.generate(ACT_ID, men, PRODUCT_KEY, DEFAULT_CANDIDATE_SELECTION);
      const filtered    = new CandidatePreFilter().filter(pool, DEFAULT_CANDIDATE_SELECTION);
      const scored      = new HybridScoreCalculator().calculate(filtered, [new NameMatcher()], DEFAULT_SCORING);
      const ranked      = new ThresholdClassifier().classifyWithCandidates(
        scored, DEFAULT_THRESHOLDS, buildCandidateMap(candidates),
      );
      return ranked.ranked[0]!.score.finalScore;
    }

    const r1 = await runPipeline();
    const r2 = await runPipeline();
    expect(r1).toBe(r2);
  });
});
