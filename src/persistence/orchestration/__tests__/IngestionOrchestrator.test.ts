import { describe, it, expect, vi } from 'vitest';
import { IngestionOrchestrator } from '../IngestionOrchestrator';
import { RepositoryFactory } from '../RepositoryFactory';
import type { IRepositorySet } from '../../types/repositoryInterfaces';
import type { VenueCollectorContract, ActivityCollectorContract, SourceConfigContract } from '../../types/collectorContracts';
import { VIVERE_60_MAIS_VENUE_FILTER_RULES } from '../../../pipeline/stages/00-filter-venue/products/vivere-60-mais';

// ─── Helpers ──────────────────────────────────────────────────

function makeRepos(): { repos: IRepositorySet; mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const mocks = {
    runStart:         vi.fn().mockResolvedValue('run-uuid-test'),
    runFinish:        vi.fn().mockResolvedValue(undefined),
    runMarkFailed:    vi.fn().mockResolvedValue(undefined),
    rawVenueInsert:   vi.fn().mockResolvedValue([{ id: 'raw-v-1', source_item_id: 'place_001' }]),
    rawActInsert:     vi.fn().mockResolvedValue([{ id: 'raw-a-1', source_item_id: 'post_001' }]),
    venueStageInsert: vi.fn().mockResolvedValue(3),
    actStageInsert:   vi.fn().mockResolvedValue(2),
  };

  const repos = RepositoryFactory.fromObject({
    ingestionRun:    { start: mocks.runStart, finish: mocks.runFinish, markFailed: mocks.runMarkFailed },
    rawVenueItem:    { insertBatch: mocks.rawVenueInsert },
    rawActivityItem: { insertBatch: mocks.rawActInsert },
    venueStaging:    { insertBatch: mocks.venueStageInsert },
    activityStaging: { insertBatch: mocks.actStageInsert },
  } as IRepositorySet);

  return { repos, mocks };
}

// SourceConfigContract minimal — sem dependência de GooglePlacesProductConfig
const venueSourceConfig: SourceConfigContract = {
  source_key: 'google_places',
  product_key: 'vivere-60-mais',
};

const activitySourceConfig: SourceConfigContract = {
  source_key: 'prefeitura_cabo_frio',
  product_key: 'vivere-60-mais',
};

function makeVenueCollector(itemCount = 2): VenueCollectorContract {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    source_key: 'google_places',
    source_item_id: `place_${i + 1}`,
    collected_at: '2026-06-30T12:00:00Z',
    name: `Lugar ${i + 1}`,
    address: null, lat: -22.88, lng: -42.01,
    phone: null, website: null, opening_hours_raw: null, image_url: null,
    source_category_hint: 'teatro',
    source_query_text: 'teatro em Cabo Frio RJ',
    source_query_kind: 'place_type' as const,
    google_types: ['performing_arts_theater'],
    google_business_status: 'OPERATIONAL' as const,
    raw_payload: {},
  }));

  return {
    sourceKey: 'google_places',
    collect: vi.fn().mockResolvedValue({ items, errors: [] }),
  };
}

function makeActivityCollector(itemCount = 1): ActivityCollectorContract {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    source_key: 'prefeitura_cabo_frio',
    source_item_id: `post_${i + 1}`,
    collected_at: '2026-06-30T12:00:00Z',
    title: `Atividade ${i + 1}`,
    description: null, raw_category_text: null,
    occurrences: [{ date: '2026-07-01', time: null, end_date: null, end_time: null }],
    recurrence_text_hint: null, venue_mention: null,
    price_text: null, is_free_hint: null,
    image_url: null, external_url: null, contact_phone: null, contact_email: null,
    language: 'pt' as const,
    raw_payload: {},
  }));

  return {
    sourceKey: 'prefeitura_cabo_frio',
    collect: vi.fn().mockResolvedValue({ items, errors: [] }),
  };
}

// ─── runVenueIngestion — caso feliz ──────────────────────────

describe('IngestionOrchestrator.runVenueIngestion — caso feliz', () => {
  it('executa start → collect → raw insert → filter → stage → finish', async () => {
    const { repos, mocks } = makeRepos();
    const collector = makeVenueCollector();

    const orchestrator = new IngestionOrchestrator(repos);
    const summary = await orchestrator.runVenueIngestion(collector, venueSourceConfig, VIVERE_60_MAIS_VENUE_FILTER_RULES);

    expect(mocks.runStart).toHaveBeenCalledWith('google_places');
    expect(mocks.rawVenueInsert).toHaveBeenCalledWith(expect.any(Array), 'run-uuid-test');
    expect(mocks.venueStageInsert).toHaveBeenCalled();
    expect(mocks.runFinish).toHaveBeenCalledWith('run-uuid-test', expect.any(Object));
    expect(summary.ingestionRunId).toBe('run-uuid-test');
    expect(summary.dryRun).toBe(false);
  });

  it('o Orchestrator não importa nem menciona GooglePlacesCollector — aceita qualquer VenueCollectorContract', async () => {
    // Collector sintético que não é GooglePlacesCollector
    const syntheticCollector: VenueCollectorContract = {
      sourceKey: 'synthetic_api',
      collect: vi.fn().mockResolvedValue({ items: [], errors: [] }),
    };
    const syntheticConfig: SourceConfigContract = { source_key: 'synthetic_api', product_key: 'vivere-60-mais' };

    const { repos } = makeRepos();
    const orchestrator = new IngestionOrchestrator(repos);

    // Deve funcionar sem nenhum import de GooglePlacesCollector
    const summary = await orchestrator.runVenueIngestion(syntheticCollector, syntheticConfig, VIVERE_60_MAIS_VENUE_FILTER_RULES);
    expect(summary.rawItemsCollected).toBe(0);
  });

  it('retorna contagens corretas no sumário', async () => {
    const { repos } = makeRepos();
    const collector = makeVenueCollector(5);

    const orchestrator = new IngestionOrchestrator(repos);
    const summary = await orchestrator.runVenueIngestion(collector, venueSourceConfig, VIVERE_60_MAIS_VENUE_FILTER_RULES);

    expect(summary.rawItemsCollected).toBe(5);
    expect(summary.rawItemsErrored).toBe(0);
  });
});

// ─── runVenueIngestion — dry-run ─────────────────────────────

describe('IngestionOrchestrator.runVenueIngestion — dry-run', () => {
  it('não chama nenhum repositório quando dryRun=true', async () => {
    const { repos, mocks } = makeRepos();
    const collector = makeVenueCollector();

    const orchestrator = new IngestionOrchestrator(repos);
    const summary = await orchestrator.runVenueIngestion(collector, venueSourceConfig, VIVERE_60_MAIS_VENUE_FILTER_RULES, { dryRun: true });

    expect(mocks.runStart).not.toHaveBeenCalled();
    expect(mocks.rawVenueInsert).not.toHaveBeenCalled();
    expect(mocks.venueStageInsert).not.toHaveBeenCalled();
    expect(mocks.runFinish).not.toHaveBeenCalled();
    expect(summary.dryRun).toBe(true);
    expect(summary.ingestionRunId).toBeNull();
  });

  it('coleta e filtra normalmente em dry-run — resultado comparável ao real', async () => {
    const { repos } = makeRepos();
    const collector = makeVenueCollector(3);

    const orchestrator = new IngestionOrchestrator(repos);
    const summary = await orchestrator.runVenueIngestion(collector, venueSourceConfig, VIVERE_60_MAIS_VENUE_FILTER_RULES, { dryRun: true });

    expect(summary.rawItemsCollected).toBe(3);
  });
});

// ─── runVenueIngestion — falha ───────────────────────────────

describe('IngestionOrchestrator.runVenueIngestion — falha', () => {
  it('chama markFailed quando a coleta lança erro', async () => {
    const { repos, mocks } = makeRepos();
    const collector: VenueCollectorContract = {
      sourceKey: 'google_places',
      collect: vi.fn().mockRejectedValue(new Error('API timeout')),
    };

    const orchestrator = new IngestionOrchestrator(repos);

    await expect(
      orchestrator.runVenueIngestion(collector, venueSourceConfig, VIVERE_60_MAIS_VENUE_FILTER_RULES),
    ).rejects.toThrow('API timeout');

    expect(mocks.runStart).toHaveBeenCalled();
    expect(mocks.runMarkFailed).toHaveBeenCalledWith('run-uuid-test', 'API timeout');
    expect(mocks.runFinish).not.toHaveBeenCalled();
  });

  it('chama markFailed quando o insertBatch lança erro', async () => {
    const { repos, mocks } = makeRepos();
    mocks.rawVenueInsert.mockRejectedValue(new Error('DB connection lost'));
    const collector = makeVenueCollector();

    const orchestrator = new IngestionOrchestrator(repos);

    await expect(
      orchestrator.runVenueIngestion(collector, venueSourceConfig, VIVERE_60_MAIS_VENUE_FILTER_RULES),
    ).rejects.toThrow('DB connection lost');

    expect(mocks.runMarkFailed).toHaveBeenCalledWith('run-uuid-test', 'DB connection lost');
  });
});

// ─── runActivityIngestion — caso feliz ───────────────────────

describe('IngestionOrchestrator.runActivityIngestion — caso feliz', () => {
  it('executa a sequência correta para atividades', async () => {
    const { repos, mocks } = makeRepos();
    const collector = makeActivityCollector(3);

    const orchestrator = new IngestionOrchestrator(repos);
    const summary = await orchestrator.runActivityIngestion(collector, activitySourceConfig);

    expect(mocks.runStart).toHaveBeenCalledWith('prefeitura_cabo_frio');
    expect(mocks.rawActInsert).toHaveBeenCalledWith(expect.any(Array), 'run-uuid-test');
    expect(mocks.actStageInsert).toHaveBeenCalled();
    expect(mocks.runFinish).toHaveBeenCalled();
    expect(summary.rawItemsCollected).toBe(3);
    expect(summary.rejectedItems).toBe(0);
  });

  it('o Orchestrator não importa WordPressContentCollector — aceita qualquer ActivityCollectorContract', async () => {
    const syntheticCollector: ActivityCollectorContract = {
      sourceKey: 'sympla_api',
      collect: vi.fn().mockResolvedValue({ items: [], errors: [] }),
    };
    const syntheticConfig: SourceConfigContract = { source_key: 'sympla_api', product_key: 'vivere-60-mais' };

    const { repos } = makeRepos();
    const orchestrator = new IngestionOrchestrator(repos);

    const summary = await orchestrator.runActivityIngestion(syntheticCollector, syntheticConfig);
    expect(summary.rawItemsCollected).toBe(0);
  });
});

// ─── RepositoryFactory ────────────────────────────────────────

describe('RepositoryFactory.fromObject', () => {
  it('retorna o IRepositorySet exatamente como passado', () => {
    const mockRepos = {
      ingestionRun:    { start: vi.fn(), finish: vi.fn(), markFailed: vi.fn() },
      rawVenueItem:    { insertBatch: vi.fn() },
      rawActivityItem: { insertBatch: vi.fn() },
      venueStaging:    { insertBatch: vi.fn() },
      activityStaging: { insertBatch: vi.fn() },
    } as unknown as IRepositorySet;

    const result = RepositoryFactory.fromObject(mockRepos);
    expect(result).toBe(mockRepos);
  });
});
