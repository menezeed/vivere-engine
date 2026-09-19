/**
 * src/persistence/orchestration/__tests__/IngestionOrchestrator.reprocessVenuesFromRaw.test.ts
 *
 * Confirma a garantia central desta sessão: reprocessVenuesFromRaw
 * usa exatamente a mesma sequência de filtro/gate/staging que
 * runVenueIngestion (via stageVenues privado) — a única diferença é
 * a origem dos dados.
 */

import { describe, it, expect, vi } from 'vitest';
import { IngestionOrchestrator } from '../IngestionOrchestrator';
import type { IRepositorySet } from '../../types/repositoryInterfaces';
import type { RawVenueItem } from '../../../types/RawVenueItem';
import type { VenueFilterRuleSet } from '../../../pipeline/stages/00-filter-venue/types';

function makeRawVenue(overrides: Partial<RawVenueItem> = {}): RawVenueItem {
  return {
    source_key: 'google_places',
    source_item_id: 'ChIJ_1',
    collected_at: '2026-07-17T10:00:00Z',
    name: 'Teatro Claro MAIS SP',
    address: 'R. Olimpíadas, 360',
    lat: -23.5989,
    lng: -46.6858,
    phone: null,
    website: null,
    opening_hours_raw: null,
    image_url: null,
    source_category_hint: 'teatro',
    source_query_text: 'teatro em Brooklin, São Paulo',
    source_query_kind: 'place_type',
    source_region_label: 'Brooklin, São Paulo',
    google_types: ['performing_arts_theater'],
    google_business_status: 'OPERATIONAL',
    raw_payload: {},
    ...overrides,
  };
}

type TestRuleId = 'accept_type_theater' | 'activity_name_reinforcement' | 'ambiguity_fallback_fitness';

const RULE_SET: VenueFilterRuleSet<TestRuleId, 'likely_fitness_generic'> = {
  // Explicitamente vazios (mode: 'override'), não omitidos — omitir
  // herdaria os defaults universais do motor (DEFAULT_REJECT_TYPE_RULES
  // etc.), cujo conteúdo exato não conheço aqui; para o teste ser
  // determinístico e não depender deles, sobrescrevo com listas vazias.
  reject_type: { mode: 'override', rules: [] },
  reject_keyword: { mode: 'override', rules: [] },
  accept_type: {
    mode: 'override',
    rules: [{ rule_id: 'accept_type_theater', google_types: ['performing_arts_theater'] }],
  },
  accept_keyword: [],
  review_keyword: [],
  review_type: [],
  activity_name_reinforcement_keywords: [],
  activity_name_reinforcement_rule_id: 'activity_name_reinforcement',
  ambiguity_fallback: {
    label: 'likely_fitness_generic',
    rule_id: 'ambiguity_fallback_fitness',
    google_types: [],
    display_reason: 'Provável academia/estúdio genérico, sem indicação clara de atender o público 60+',
  },
};

const SOURCE_CONFIG = {
  source_key: 'google_places',
  product_key: 'vivere-60-mais',
  regions: [
    { key: 'sp_brooklin_pilot', display_label: 'Brooklin, São Paulo', lat: -23.61011, lng: -46.686907, radius_m: 2500 },
  ],
};

function makeRepos(overrides: Partial<{ [K in keyof IRepositorySet]: Partial<IRepositorySet[K]> }> = {}): IRepositorySet {
  return {
    ingestionRun: {
      start: vi.fn().mockResolvedValue('run-reprocess-1'),
      finish: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      ...overrides.ingestionRun,
    },
    rawVenueItem: {
      insertBatch: vi.fn().mockResolvedValue([]),
      findByRegionLabel: vi.fn().mockResolvedValue([
        { item: makeRawVenue(), persisted: { id: 'raw-uuid-1', source_item_id: 'ChIJ_1' } },
      ]),
      ...overrides.rawVenueItem,
    },
    rawActivityItem: { insertBatch: vi.fn().mockResolvedValue([]), ...overrides.rawActivityItem },
    venueStaging: { insertBatch: vi.fn().mockResolvedValue(1), ...overrides.venueStaging },
    activityStaging: { insertBatch: vi.fn().mockResolvedValue(0), ...overrides.activityStaging },
  } as IRepositorySet;
}

describe('IngestionOrchestrator.reprocessVenuesFromRaw', () => {
  it('lê via findByRegionLabel — NUNCA chama rawVenueItem.insertBatch', async () => {
    const repos = makeRepos();
    const orchestrator = new IngestionOrchestrator(repos);

    await orchestrator.reprocessVenuesFromRaw(SOURCE_CONFIG, RULE_SET, 'Brooklin, São Paulo');

    expect(repos.rawVenueItem.findByRegionLabel).toHaveBeenCalledWith('google_places', 'Brooklin, São Paulo');
    expect(repos.rawVenueItem.insertBatch).not.toHaveBeenCalled();
  });

  it('chama venueStaging.insertBatch — a mesma chamada que runVenueIngestion faria', async () => {
    const repos = makeRepos();
    const orchestrator = new IngestionOrchestrator(repos);

    await orchestrator.reprocessVenuesFromRaw(SOURCE_CONFIG, RULE_SET, 'Brooklin, São Paulo');

    expect(repos.venueStaging.insertBatch).toHaveBeenCalledTimes(1);
    const [filteredItems, persistedRaw, productKey] = (repos.venueStaging.insertBatch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(productKey).toBe('vivere-60-mais');
    expect(persistedRaw).toEqual([{ id: 'raw-uuid-1', source_item_id: 'ChIJ_1' }]);
    expect(filteredItems).toHaveLength(1);
  });

  it('abre e fecha um IngestionRun — mesma auditoria de uma execução ao vivo', async () => {
    const repos = makeRepos();
    const orchestrator = new IngestionOrchestrator(repos);

    const summary = await orchestrator.reprocessVenuesFromRaw(SOURCE_CONFIG, RULE_SET, 'Brooklin, São Paulo');

    expect(repos.ingestionRun.start).toHaveBeenCalledWith('google_places');
    expect(repos.ingestionRun.finish).toHaveBeenCalledWith('run-reprocess-1', { itemsCollected: 1, itemsErrored: 0 });
    expect(summary.ingestionRunId).toBe('run-reprocess-1');
  });

  it('marca o IngestionRun como failed se a leitura da Camada A lançar', async () => {
    const repos = makeRepos({
      rawVenueItem: { findByRegionLabel: vi.fn().mockRejectedValue(new Error('falha de leitura')) },
    });
    const orchestrator = new IngestionOrchestrator(repos);

    await expect(
      orchestrator.reprocessVenuesFromRaw(SOURCE_CONFIG, RULE_SET, 'Brooklin, São Paulo'),
    ).rejects.toThrow('falha de leitura');

    expect(repos.ingestionRun.markFailed).toHaveBeenCalledWith('run-reprocess-1', 'falha de leitura');
  });

  it('modo dry-run: não abre IngestionRun, não persiste nada, mas ainda calcula o resultado do filtro/gate', async () => {
    const repos = makeRepos();
    const orchestrator = new IngestionOrchestrator(repos);

    const summary = await orchestrator.reprocessVenuesFromRaw(SOURCE_CONFIG, RULE_SET, 'Brooklin, São Paulo', {
      dryRun: true,
    });

    expect(repos.ingestionRun.start).not.toHaveBeenCalled();
    expect(repos.venueStaging.insertBatch).not.toHaveBeenCalled();
    expect(summary.ingestionRunId).toBeNull();
    expect(summary.dryRun).toBe(true);
    expect(summary.rawItemsCollected).toBe(1);
  });

  it('aplica o Regional Geographic Gate (ADR-0022) sobre os dados lidos, exatamente como na ingestão real', async () => {
    const farItem = makeRawVenue({ source_item_id: 'ChIJ_far', lat: -23.5614, lng: -46.6558 });
    const repos = makeRepos({
      rawVenueItem: {
        findByRegionLabel: vi.fn().mockResolvedValue([
          { item: farItem, persisted: { id: 'raw-uuid-far', source_item_id: 'ChIJ_far' } },
        ]),
      },
    });
    const orchestrator = new IngestionOrchestrator(repos);

    const summary = await orchestrator.reprocessVenuesFromRaw(SOURCE_CONFIG, RULE_SET, 'Brooklin, São Paulo');

    expect(summary.geoExcludedItems).toBe(1);
  });
});
