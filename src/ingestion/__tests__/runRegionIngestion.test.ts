/**
 * E5 — runRegionIngestion com repositórios em memória e fixtures
 * WordPress (sem rede, sem BD). getSupabaseClient/createClient falham se
 * forem chamados e são verificados depois de cada teste.
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';

const guards = vi.hoisted(() => ({
  getSupabaseClient: vi.fn(() => {
    throw new Error('E5: getSupabaseClient() não pode ser chamado neste teste');
  }),
  createClient: vi.fn(() => {
    throw new Error('E5: createClient() não pode ser chamado neste teste');
  }),
}));
vi.mock('../../persistence/client/supabase', () => ({ getSupabaseClient: guards.getSupabaseClient, _resetSupabaseClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: guards.createClient }));

import { runRegionIngestion, planRegionSources, RegionIngestionError, type RegionIngestionDeps } from '../runRegionIngestion';
import { getRegion, type RegionDefinition } from '../../config/regions';
import { AVAILABLE_INSTANCES } from '../../collectors/wordpress-content/config/registry';
import type { WordPressApiClient, WordPressPost, FetchPostsResult } from '../../collectors/wordpress-content/WordPressApiClient';
import type { IRepositorySet } from '../../persistence/types/repositoryInterfaces';
import type { RawActivityItem } from '../../types/RawActivityItem';
import { exitCodeFor, formatRegionResult } from '../../../scripts/ingest-region';

const NOW = '2026-11-14T12:00:00.000Z';
const SINCE_DAYS = 200;

const BASE_URL_TO_FIXTURE = new Map(
  (['cabo-frio', 'sao-pedro-da-aldeia', 'rio-das-ostras', 'buzios'] as const).map((k) => [AVAILABLE_INSTANCES[k]!.base_url, k]),
);

function loadPosts(instance: string): WordPressPost[] {
  const url = new URL(`../../collectors/wordpress-content/__tests__/fixtures/${instance}.posts.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as WordPressPost[];
}

/** Repositórios em memória com as chaves de conflito reais (como no L7). */
function memoryRepos() {
  const raw: RawActivityItem[] = [];
  const rawKeys = new Map<string, string>();
  let runSeq = 0;
  const repos: IRepositorySet = {
    ingestionRun: { start: async () => `run-${++runSeq}`, finish: async () => undefined, markFailed: async () => undefined },
    rawVenueItem: { insertBatch: async () => { throw new Error('venues fora do E5'); } },
    venueStaging: { insertBatch: async () => { throw new Error('venues fora do E5'); } },
    rawActivityItem: {
      insertBatch: async (items, runId) => {
        const out: Array<{ id: string; source_item_id: string }> = [];
        for (const i of items) {
          const key = `${i.source_key}|${i.source_item_id}|${runId}`;
          if (rawKeys.has(key)) continue;
          const id = `raw-${rawKeys.size + 1}`;
          rawKeys.set(key, id);
          raw.push(i);
          out.push({ id, source_item_id: i.source_item_id });
        }
        return out;
      },
    },
    activityStaging: { insertBatch: async (items, persisted) => items.filter((d) => persisted.some((p) => p.source_item_id === d.item.source_item_id)).length },
  };
  return { repos, raw };
}

function makeDeps(overrides: Partial<RegionIngestionDeps> = {}) {
  const events: string[] = [];
  const memory = memoryRepos();
  const deps: RegionIngestionDeps = {
    createRepos: vi.fn(() => {
      events.push('createRepos');
      return memory.repos;
    }),
    createApiClient: vi.fn((baseUrl: string) => {
      const fixture = BASE_URL_TO_FIXTURE.get(baseUrl);
      if (!fixture) throw new Error(`sem fixture para ${baseUrl}`);
      return {
        fetchPosts: async (): Promise<FetchPostsResult> => {
          events.push(`fetch:${fixture}`);
          return { posts: loadPosts(fixture), totalPages: 1 };
        },
      } as unknown as WordPressApiClient;
    }),
    now: () => NOW,
    ...overrides,
  };
  return { deps, events, memory };
}

// collected_at vem do relógio do collector: fixo para comparar execuções.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterAll(() => vi.useRealTimers());

afterEach(() => {
  expect(guards.getSupabaseClient).not.toHaveBeenCalled();
  expect(guards.createClient).not.toHaveBeenCalled();
});

describe('planRegionSources', () => {
  it('Cabo Frio: WordPress executável, Google Places recusado (L5)', () => {
    const { planned, refused } = planRegionSources(getRegion('cabo_frio'));
    expect(planned.map((p) => p.sourceKey)).toEqual(['prefeitura_cabo_frio']);
    expect(refused).toEqual([{ source_key: 'google_places', reason: expect.stringContaining('L5') }]);
  });

  it('Búzios e Rio das Ostras (sem centro) têm a sua fonte WordPress', () => {
    expect(planRegionSources(getRegion('buzios')).planned.map((p) => p.sourceKey)).toEqual(['prefeitura_buzios']);
    expect(planRegionSources(getRegion('rio_das_ostras')).planned.map((p) => p.sourceKey)).toEqual(['prefeitura_rio_das_ostras']);
  });
});

describe('runRegionIngestion', () => {
  it('região desconhecida → erro explícito, sem criar repositórios nem pedir fontes', async () => {
    const { deps } = makeDeps();
    await expect(runRegionIngestion('atlantida', { dryRun: false }, deps)).rejects.toThrow(RegionIngestionError);
    expect(deps.createRepos).not.toHaveBeenCalled();
    expect(deps.createApiClient).not.toHaveBeenCalled();
  });

  it('região só com Google Places (Araruama) → recusada explicitamente', async () => {
    const { deps } = makeDeps();
    await expect(runRegionIngestion('araruama', { dryRun: true }, deps)).rejects.toThrow(/não tem fontes WordPress executáveis \(recusadas: google_places\)/);
    expect(deps.createApiClient).not.toHaveBeenCalled();
  });

  it('dry-run: não cria repositórios; relatórios L4 + E7 calculados; Google Places recusado', async () => {
    const { deps } = makeDeps();
    const result = await runRegionIngestion('cabo_frio', { dryRun: true, sinceDays: SINCE_DAYS }, deps);
    expect(deps.createRepos).not.toHaveBeenCalled();
    expect(result.dry_run).toBe(true);
    expect(result.refused_sources.map((r) => r.source_key)).toEqual(['google_places']);
    expect(result.sources).toEqual([
      expect.objectContaining({ source_key: 'prefeitura_cabo_frio', status: 'success', summary: expect.objectContaining({ dryRun: true, rawItemsCollected: 3, rawItemsPersisted: 0, stagedItems: 0 }) }),
    ]);
    expect(result.quality.totals).toMatchObject({ total_items: 3, with_date: { count: 3, pct: 100 } });
    expect(result.quality.totals.publication_delay.items_with_published_at).toBe(3);
    // Último post das fixtures de Cabo Frio: 25/06 → stale_source (14 dias).
    expect(result.health.alerts.map((a) => [a.source_key, a.code])).toEqual([['prefeitura_cabo_frio', 'stale_source']]);
    expect(exitCodeFor(result)).toBe(0);
  });

  it('modo real (repositórios injectados): repositórios criados ANTES de qualquer pedido às fontes; itens gravados', async () => {
    const { deps, events, memory } = makeDeps();
    const result = await runRegionIngestion('rio_das_ostras', { dryRun: false, sinceDays: SINCE_DAYS }, deps);
    expect(events).toEqual(['createRepos', 'fetch:rio-das-ostras']);
    expect(result.sources[0]!.summary).toMatchObject({ rawItemsCollected: 2, rawItemsPersisted: 2, stagedItems: 2, ingestionRunId: 'run-1' });
    expect(memory.raw).toHaveLength(2);
    // "Data: Domingo, 8 de novembro" ganha ano pela regra do ano mais próximo;
    // a exposição ("Em cartaz até…") continua sem data → 1 de 2 (50%, sem alerta).
    expect(result.health.alerts.map((a) => a.code)).toEqual([]);
    // Descartes = só posts sem nenhum item, agregados por classe (o item
    // sem data da exposição NÃO é descarte).
    expect(formatRegionResult(result)).toContain(
      'prefeitura_rio_das_ostras: recolhidos 2, gravados 2, staged 2, descartes 1 (no_extractable_schedule_found 1)',
    );
  });

  it('idempotente: duas execuções da mesma região produzem o mesmo resultado', async () => {
    const a = await runRegionIngestion('sao_pedro_da_aldeia', { dryRun: false, sinceDays: SINCE_DAYS }, makeDeps().deps);
    const b = await runRegionIngestion('sao_pedro_da_aldeia', { dryRun: false, sinceDays: SINCE_DAYS }, makeDeps().deps);
    expect(b).toEqual(a);
    expect(a.sources[0]!.summary).toMatchObject({ rawItemsCollected: 2, rawItemsPersisted: 2 });
  });

  it('a mesma região duas vezes com os MESMOS repositórios: cada execução grava as suas linhas (chave por run)', async () => {
    const { deps, memory } = makeDeps();
    await runRegionIngestion('buzios', { dryRun: false, sinceDays: SINCE_DAYS }, deps);
    await runRegionIngestion('buzios', { dryRun: false, sinceDays: SINCE_DAYS }, deps);
    expect(memory.raw).toHaveLength(2);
    expect(memory.raw[0]).toEqual(memory.raw[1]);
  });

  it('fonte que falha → execução failed no E7 (critical) e código de saída 1, sem interromper o relatório', async () => {
    const { deps } = makeDeps({
      createApiClient: vi.fn(() => ({
        fetchPosts: async () => {
          throw new Error('WordPress REST API falhou (503)');
        },
      }) as unknown as WordPressApiClient),
    });
    const result = await runRegionIngestion('buzios', { dryRun: true }, deps);
    expect(result.sources).toEqual([expect.objectContaining({ status: 'failed', error: 'WordPress REST API falhou (503)', summary: null })]);
    expect(result.health.status).toBe('critical');
    expect(result.health.alerts.map((a) => a.code)).toEqual(['zero_items', 'run_failed']);
    expect(exitCodeFor(result)).toBe(1);
    expect(formatRegionResult(result)).toContain('prefeitura_buzios: FALHOU — WordPress REST API falhou (503)');
  });

  describe('isolamento por fonte (revisão r0 do #14)', () => {
    const DUAS: RegionDefinition = {
      key: 'duas_fontes',
      city_label: 'Teste RJ',
      city: 'Teste',
      state: 'RJ',
      center: null,
      radius_m: null,
      sources: ['prefeitura_cabo_frio', 'prefeitura_buzios'],
    };

    function depsWith(failing: 'init' | 'collect', failingBaseUrl: string) {
      const base = makeDeps();
      const ok = base.deps.createApiClient;
      return makeDeps({
        regions: [DUAS],
        createApiClient: vi.fn((baseUrl: string) => {
          if (baseUrl !== failingBaseUrl) return ok(baseUrl);
          if (failing === 'init') throw new Error('falha a criar o cliente');
          return { fetchPosts: async () => { throw new Error('falha na recolha'); } } as unknown as WordPressApiClient;
        }),
      });
    }

    it.each([['init'], ['collect']] as const)('fonte que falha em %s → outcome failed; a outra fonte corre e grava os seus itens', async (failing) => {
      const caboFrioUrl = AVAILABLE_INSTANCES['cabo-frio']!.base_url;
      const { deps, memory } = depsWith(failing, caboFrioUrl);
      const result = await runRegionIngestion('duas_fontes', { dryRun: false, sinceDays: SINCE_DAYS }, deps);
      const reason = failing === 'init' ? 'falha a criar o cliente' : 'falha na recolha';
      expect(result.sources.map((s) => [s.source_key, s.status, s.error])).toEqual([
        ['prefeitura_cabo_frio', 'failed', reason],
        ['prefeitura_buzios', 'success', null],
      ]);
      expect(result.sources[1]!.summary).toMatchObject({ rawItemsCollected: 1, rawItemsPersisted: 1 });
      expect(memory.raw.map((i) => i.source_key)).toEqual(['prefeitura_buzios']);
      expect(result.quality.by_group.map((g) => [g.source_key, g.total_items])).toEqual([['prefeitura_buzios', 1]]);
      const cf = result.health.sources.find((s) => s.source_key === 'prefeitura_cabo_frio')!;
      expect(cf.alerts.map((a) => a.code)).toEqual(['zero_items', 'run_failed']);
      expect(cf.alerts[1]!.data['error_message']).toBe(reason);
      expect(exitCodeFor(result)).toBe(1);
    });

    it('a fonte que falha na inicialização pode ser a última: as anteriores já correram', async () => {
      const { deps } = depsWith('init', AVAILABLE_INSTANCES['buzios']!.base_url);
      const result = await runRegionIngestion('duas_fontes', { dryRun: true, sinceDays: SINCE_DAYS }, deps);
      expect(result.sources.map((s) => s.status)).toEqual(['success', 'failed']);
      expect(result.quality.totals.total_items).toBe(3);
    });
  });

  it('relatório anterior fornecido → queda de volume avaliada', async () => {
    const first = await runRegionIngestion('cabo_frio', { dryRun: true, sinceDays: SINCE_DAYS }, makeDeps().deps);
    const empty = makeDeps({
      createApiClient: vi.fn(() => ({ fetchPosts: async () => ({ posts: [], totalPages: 1 }) }) as unknown as WordPressApiClient),
    });
    const second = await runRegionIngestion('cabo_frio', { dryRun: true, sinceDays: SINCE_DAYS, previousReport: first.quality }, empty.deps);
    expect(second.health.alerts[0]).toMatchObject({ code: 'zero_items', data: { previous_items: 3 } });
    expect(exitCodeFor(second)).toBe(2);
  });
});
