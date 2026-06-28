import { describe, it, expect, vi } from 'vitest';
import { GooglePlacesCollector } from '../GooglePlacesCollector';
import { InMemoryBudgetRepo } from '../../../lib/budgetGuard';
import { buildQueriesForProduct, type GooglePlacesProductConfig } from '../config/GooglePlacesProductConfig';
import type { GooglePlacesApiClient, GooglePlaceRaw } from '../GooglePlacesApiClient';

function makeFakeApiClient(placesByQuery: Record<string, GooglePlaceRaw[]>): GooglePlacesApiClient {
  return {
    textSearch: vi.fn(async ({ query }: { query: string }) => ({
      places: placesByQuery[query] ?? [],
      costUsd: 0.032,
    })),
    getEnrichedDetails: vi.fn(async (placeId: string) => ({
      details: { id: placeId },
      costUsd: 0,
    })),
  } as unknown as GooglePlacesApiClient;
}

function makePlace(overrides: Partial<GooglePlaceRaw>): GooglePlaceRaw {
  return {
    id: 'place_1',
    displayName: { text: 'Lugar de teste' },
    formattedAddress: 'Rua Teste, 1',
    location: { latitude: -22.0, longitude: -42.0 },
    types: ['point_of_interest'],
    businessStatus: 'OPERATIONAL',
    ...overrides,
  };
}

const SMALL_CONFIG_A: GooglePlacesProductConfig = {
  product_key: 'produto_a_teste',
  source_priority: 70,
  regions: [{ key: 'cidade_a', display_label: 'Cidade A', lat: -22.0, lng: -42.0, radius_m: 5000 }],
  categories: [{ key: 'teatro', query_text: 'teatro', kind: 'place_type' }],
  monthly_budget_usd: 10.0,
  hard_stop_enabled: true,
  alert_threshold_pct: 0.8,
};

const SMALL_CONFIG_B: GooglePlacesProductConfig = {
  product_key: 'produto_b_teste',
  source_priority: 70,
  regions: [
    { key: 'cidade_x', display_label: 'Cidade X', lat: -10.0, lng: -50.0, radius_m: 8000 },
    { key: 'cidade_y', display_label: 'Cidade Y', lat: -11.0, lng: -51.0, radius_m: 8000 },
    { key: 'cidade_z', display_label: 'Cidade Z', lat: -12.0, lng: -52.0, radius_m: 8000 },
  ],
  categories: [
    { key: 'pousada', query_text: 'pousada', kind: 'place_type' },
    { key: 'restaurante', query_text: 'restaurante', kind: 'place_type' },
  ],
  monthly_budget_usd: 5.0,
  hard_stop_enabled: true,
  alert_threshold_pct: 0.8,
};

describe('buildQueriesForProduct — produto cartesiano genérico, sem suposição de quantidade', () => {
  it('gera exatamente 1 query para 1 região x 1 categoria', () => {
    expect(buildQueriesForProduct(SMALL_CONFIG_A)).toHaveLength(1);
  });

  it('gera exatamente 6 queries para 3 regiões x 2 categorias — prova que não há limite binário de 2 regiões', () => {
    const queries = buildQueriesForProduct(SMALL_CONFIG_B);
    expect(queries).toHaveLength(6);
  });

  it('cada região usa seu próprio display_label no texto da query, nunca um if/else fixo', () => {
    const queries = buildQueriesForProduct(SMALL_CONFIG_B);
    expect(queries.some((q) => q.query_text === 'pousada em Cidade X')).toBe(true);
    expect(queries.some((q) => q.query_text === 'restaurante em Cidade Z')).toBe(true);
  });
});

describe('GooglePlacesCollector — instanciado com configs de produto diferentes, mesmo motor', () => {
  it('produto A (1 região, 1 categoria) executa exatamente 1 query', async () => {
    const client = makeFakeApiClient({
      'teatro em Cidade A': [makePlace({ id: 'p1', displayName: { text: 'Teatro Municipal' } })],
    });
    const budgetRepo = new InMemoryBudgetRepo({
      provider: 'google_places',
      monthly_budget_usd: 10,
      hard_stop_enabled: true,
      alert_threshold_pct: 0.8,
    });

    const collector = new GooglePlacesCollector(client, budgetRepo, SMALL_CONFIG_A);
    const result = await collector.collect();

    expect(result.stats.queries_executed).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Teatro Municipal');
  });

  it('produto B (3 regiões, 2 categorias) executa 6 queries com o MESMO código do Collector', async () => {
    const client = makeFakeApiClient({
      'pousada em Cidade X': [makePlace({ id: 'p2', displayName: { text: 'Pousada do Mar' } })],
      'restaurante em Cidade Y': [makePlace({ id: 'p3', displayName: { text: 'Restaurante Sabor' } })],
    });
    const budgetRepo = new InMemoryBudgetRepo({
      provider: 'google_places',
      monthly_budget_usd: 5,
      hard_stop_enabled: true,
      alert_threshold_pct: 0.8,
    });

    const collector = new GooglePlacesCollector(client, budgetRepo, SMALL_CONFIG_B);
    const result = await collector.collect();

    expect(result.stats.queries_executed).toBe(6);
    expect(result.items.map((i) => i.name)).toEqual(
      expect.arrayContaining(['Pousada do Mar', 'Restaurante Sabor']),
    );
  });

  it('source_category_hint reflete a categoria real configurada para cada produto, não um valor fixo', async () => {
    const client = makeFakeApiClient({
      'pousada em Cidade X': [makePlace({ id: 'p4', displayName: { text: 'Pousada Teste' } })],
    });
    const budgetRepo = new InMemoryBudgetRepo({
      provider: 'google_places',
      monthly_budget_usd: 5,
      hard_stop_enabled: true,
      alert_threshold_pct: 0.8,
    });

    const collector = new GooglePlacesCollector(client, budgetRepo, SMALL_CONFIG_B);
    const result = await collector.collect({ limitQueries: 1 });

    expect(result.items[0].source_category_hint).toBe('pousada');
  });
});
