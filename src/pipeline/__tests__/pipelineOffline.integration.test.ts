/**
 * L7 — teste de integração OFFLINE do pipeline de actividades, ponta a
 * ponta até à fronteira da base de dados:
 *
 *   fixtures WordPress (Cabo Frio, São Pedro da Aldeia, Rio das Ostras,
 *   Búzios) → WordPressApiClient FALSO → WordPressContentCollector
 *   (fetchPostsSince + mapToRawActivityItems reais) → IngestionOrchestrator
 *   real (02-recurrence-detection) → repositórios EM MEMÓRIA (a fronteira
 *   da BD) → computeRunQualityMetrics (L4).
 *
 * Sem rede, sem Supabase: getSupabaseClient e createClient estão
 * substituídos por funções que FALHAM se forem chamadas, e o teste
 * verifica que nunca o foram.
 *
 * Limite: depois de raw_activity_items/activities_staging (repositórios
 * Supabase), as etapas seguintes — Entity Resolution e Publishing — leem
 * da BD; ficam fora deste teste. 00-filter-venue e 01-geographic-gate só
 * se aplicam a venues (Google Places), não a actividades.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';

const supabaseGuards = vi.hoisted(() => ({
  getSupabaseClient: vi.fn(() => {
    throw new Error('L7: getSupabaseClient() não pode ser chamado no teste offline');
  }),
  createClient: vi.fn(() => {
    throw new Error('L7: createClient() não pode ser chamado no teste offline');
  }),
}));

vi.mock('../../persistence/client/supabase', () => ({
  getSupabaseClient: supabaseGuards.getSupabaseClient,
  _resetSupabaseClient: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: supabaseGuards.createClient }));

import { WordPressContentCollector } from '../../collectors/wordpress-content/WordPressContentCollector';
import type { WordPressApiClient, WordPressPost, FetchPostsResult } from '../../collectors/wordpress-content/WordPressApiClient';
import { AVAILABLE_INSTANCES } from '../../collectors/wordpress-content/config/registry';
import { IngestionOrchestrator } from '../../persistence/orchestration/IngestionOrchestrator';
import type { IRepositorySet } from '../../persistence/types/repositoryInterfaces';
import type { IngestionSummary } from '../../persistence/types/persistenceTypes';
import type { RecurrenceDetectedItem } from '../stages/02-recurrence-detection';
import { computeRunQualityMetrics, type RunQualityReport } from '../metrics/runQualityMetrics';
import { parseWordPressGmtDate } from '../../lib/wordpressDates';
import type { RawActivityItem } from '../../types/RawActivityItem';

const NOW = '2026-11-14T12:00:00.000Z';
const SINCE_DAYS = 200; // cobre todas as fixtures (jun–nov 2026)
const INSTANCES = ['cabo-frio', 'sao-pedro-da-aldeia', 'rio-das-ostras', 'buzios'] as const;

function loadPosts(instance: string): WordPressPost[] {
  const url = new URL(`../../collectors/wordpress-content/__tests__/fixtures/${instance}.posts.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as WordPressPost[];
}

function fakeApiClient(posts: WordPressPost[]): WordPressApiClient {
  return {
    fetchPosts: vi.fn(async (): Promise<FetchPostsResult> => ({ posts, totalPages: 1 })),
  } as unknown as WordPressApiClient;
}

/** Repositórios em memória: registam o que SERIA gravado, sem BD. */
function memoryRepos() {
  const raw: RawActivityItem[] = [];
  const staged: RecurrenceDetectedItem[] = [];
  const runs: Array<{ id: string; sourceKey: string; finished?: { itemsCollected: number; itemsErrored: number }; failed?: string }> = [];
  const forbidden = (name: string) => async () => {
    throw new Error(`L7: ${name} não pertence ao fluxo de actividades`);
  };
  const repos: IRepositorySet = {
    ingestionRun: {
      start: async (sourceKey) => {
        const id = `run-${runs.length + 1}`;
        runs.push({ id, sourceKey });
        return id;
      },
      finish: async (id, stats) => {
        runs.find((r) => r.id === id)!.finished = stats;
      },
      markFailed: async (id, reason) => {
        runs.find((r) => r.id === id)!.failed = reason;
      },
    },
    rawVenueItem: { insertBatch: forbidden('rawVenueItem.insertBatch') },
    venueStaging: { insertBatch: forbidden('venueStaging.insertBatch') },
    rawActivityItem: {
      insertBatch: async (items) => {
        raw.push(...items);
        return items.map((i) => ({ id: `raw:${i.source_key}:${i.source_item_id}`, source_item_id: i.source_item_id }));
      },
    },
    activityStaging: {
      insertBatch: async (items) => {
        staged.push(...items);
        return items.length;
      },
    },
  };
  return { repos, raw, staged, runs };
}

interface RunResult {
  summaries: Record<string, IngestionSummary>;
  errorsBySource: Record<string, string[]>;
  raw: RawActivityItem[];
  staged: RecurrenceDetectedItem[];
  runs: ReturnType<typeof memoryRepos>['runs'];
  report: RunQualityReport;
}

async function runPipeline(): Promise<RunResult> {
  const { repos, raw, staged, runs } = memoryRepos();
  const orchestrator = new IngestionOrchestrator(repos);
  const summaries: Record<string, IngestionSummary> = {};
  const errorsBySource: Record<string, string[]> = {};
  const publishedAt = new Map<string, string>();

  for (const instance of INSTANCES) {
    const config = AVAILABLE_INSTANCES[instance]!;
    const posts = loadPosts(instance);
    for (const p of posts) publishedAt.set(`${config.source_key}:${p.id}`, parseWordPressGmtDate(p.date_gmt).toISOString());

    const collector = new WordPressContentCollector(fakeApiClient(posts), config);
    // Captura os erros do collector (motivos de revisão/descarte) sem mudar o fluxo.
    const original = collector.collect.bind(collector);
    collector.collect = async (opts) => {
      const result = await original(opts);
      errorsBySource[config.source_key] = result.errors.map((e) => e.message);
      return result;
    };
    summaries[config.source_key] = await orchestrator.runActivityIngestion(collector, config, { sinceDays: SINCE_DAYS });
  }

  const report = computeRunQualityMetrics(raw, {
    runId: 'l7-offline',
    generatedAt: NOW,
    resolvePublishedAt: (i) => publishedAt.get(`${i.source_key}:${String(i.raw_payload['wp_post_id'])}`) ?? null,
  });
  return { summaries, errorsBySource, raw, staged, runs, report };
}

describe('L7 — pipeline offline: fixtures → collector → orquestrador → fronteira da BD → métricas', () => {
  let first: RunResult;
  let second: RunResult;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    first = await runPipeline();
    second = await runPipeline();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('nenhum caminho cria cliente Supabase', () => {
    expect(supabaseGuards.getSupabaseClient).not.toHaveBeenCalled();
    expect(supabaseGuards.createClient).not.toHaveBeenCalled();
  });

  it('contagens por fonte no resumo do orquestrador e nos repositórios', () => {
    const counts = Object.fromEntries(
      Object.entries(first.summaries).map(([k, s]) => [k, [s.rawItemsCollected, s.rawItemsPersisted, s.stagedItems, s.rawItemsErrored]]),
    );
    // [recolhidos, gravados raw, staged, erros/descartes do collector]
    expect(counts).toEqual({
      prefeitura_cabo_frio: [3, 3, 3, 1],
      prefeitura_sao_pedro_da_aldeia: [2, 2, 2, 1],
      prefeitura_rio_das_ostras: [2, 2, 2, 3],
      prefeitura_buzios: [1, 1, 1, 1],
    });
    expect(first.raw).toHaveLength(8);
    expect(first.staged).toHaveLength(8);
    expect(first.runs.every((r) => r.finished && !r.failed)).toBe(true);
    expect(first.runs.map((r) => r.sourceKey)).toEqual([
      'prefeitura_cabo_frio',
      'prefeitura_sao_pedro_da_aldeia',
      'prefeitura_rio_das_ostras',
      'prefeitura_buzios',
    ]);
  });

  it('datas sem ano vão para revisão sem data inventada (Rio das Ostras e São Pedro)', () => {
    for (const sourceKey of ['prefeitura_rio_das_ostras', 'prefeitura_sao_pedro_da_aldeia']) {
      const structured = first.raw.filter(
        (i) => i.source_key === sourceKey && i.raw_payload['extraction_method'] === 'structured_block',
      );
      expect(structured.length).toBeGreaterThan(0);
      for (const item of structured) expect(item.occurrences).toEqual([]);
    }
    const reasons = (k: string) => first.errorsBySource[k]!.filter((m) => m.includes('structured_subevent_missing_date')).length;
    expect(reasons('prefeitura_rio_das_ostras')).toBe(2);
    expect(reasons('prefeitura_sao_pedro_da_aldeia')).toBe(1);
    // Nenhuma ocorrência fora do que as fixtures dizem literalmente.
    const allDates = first.raw.flatMap((i) => i.occurrences.map((o) => o.date)).sort();
    expect(allDates).toEqual(['2026-06-26', '2026-06-26', '2026-06-28', '2026-10-21']);
  });

  it('02-recurrence-detection corre sobre os itens antes da fronteira da BD', () => {
    const feira = first.staged.find((d) => d.item.title.startsWith('Feira de adoção'));
    expect(feira).toBeDefined();
    expect(feira!.item.occurrences).toEqual([]);
    expect(feira!.recurrence.recurrence_type).toBe('weekly');
    expect(feira!.recurrence.recurrence_days).toEqual([5]);
    const yoga = first.staged.find((d) => d.item.title === 'Yoga no Forte')!;
    expect(yoga.recurrence.recurrence_type).toBeNull();
  });

  it('métricas L4 da execução completa', () => {
    const { totals, by_group } = first.report;
    expect(totals.total_items).toBe(8);
    expect(totals.with_date).toEqual({ count: 4, pct: 50 });
    expect(totals.duplicates).toEqual({ count: 0, pct: 0 });
    expect(totals.publication_delay.items_with_published_at).toBe(8);
    expect(by_group.map((g) => [g.source_key, g.total_items, g.with_date.count])).toEqual([
      ['prefeitura_buzios', 1, 1],
      ['prefeitura_cabo_frio', 3, 3],
      ['prefeitura_rio_das_ostras', 2, 0],
      ['prefeitura_sao_pedro_da_aldeia', 2, 0],
    ]);
    expect(first.report.geographic_gate).toBeNull();
  });

  it('idempotência: duas execuções produzem exactamente os mesmos itens, ids e métricas', () => {
    expect(second.raw).toEqual(first.raw);
    expect(second.staged).toEqual(first.staged);
    expect(second.report).toEqual(first.report);
    const ids = first.raw.map((i) => `${i.source_key}:${i.source_item_id}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.raw.map((i) => `${i.source_key}:${i.source_item_id}`)).toEqual(ids);
  });

  it('dry-run do orquestrador não toca em nenhum repositório', async () => {
    const { repos, raw, staged, runs } = memoryRepos();
    const config = AVAILABLE_INSTANCES['cabo-frio']!;
    const summary = await new IngestionOrchestrator(repos).runActivityIngestion(
      new WordPressContentCollector(fakeApiClient(loadPosts('cabo-frio')), config),
      config,
      { dryRun: true, sinceDays: SINCE_DAYS },
    );
    expect(summary).toMatchObject({ dryRun: true, ingestionRunId: null, rawItemsCollected: 3, rawItemsPersisted: 0, stagedItems: 0 });
    expect([raw.length, staged.length, runs.length]).toEqual([0, 0, 0]);
  });
});
