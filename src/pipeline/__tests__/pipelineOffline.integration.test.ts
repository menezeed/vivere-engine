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
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
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

/**
 * Repositórios em memória: registam o que SERIA gravado, sem BD.
 *
 * Simulam a semântica de conflito dos repositórios reais (revisão r0):
 *  - raw_activity_items: upsert com onConflict
 *    (source_key, source_item_id, ingestion_run_id) e ignoreDuplicates —
 *    só as linhas NOVAS são devolvidas (RawActivityItemRepository);
 *  - activities_staging: upsert com onConflict raw_activity_item_id e
 *    ignoreDuplicates; itens sem linha raw correspondente não são
 *    gravados (ActivityStagingRepository).
 * Limite: não simulam FKs, triggers, RLS nem erros da BD.
 */
function memoryRepos() {
  const raw: RawActivityItem[] = [];
  const rawKeys = new Map<string, string>(); // chave de conflito → id
  const staged: RecurrenceDetectedItem[] = [];
  const stagedRawIds = new Set<string>();
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
      insertBatch: async (items, runId) => {
        const inserted: Array<{ id: string; source_item_id: string }> = [];
        for (const i of items) {
          const key = `${i.source_key}|${i.source_item_id}|${runId}`;
          if (rawKeys.has(key)) continue; // ignoreDuplicates
          const id = `raw-${rawKeys.size + 1}`;
          rawKeys.set(key, id);
          raw.push(i);
          inserted.push({ id, source_item_id: i.source_item_id });
        }
        return inserted;
      },
    },
    activityStaging: {
      insertBatch: async (items, persistedRaw) => {
        const rawIdBySourceItemId = new Map(persistedRaw.map((p) => [p.source_item_id, p.id]));
        let count = 0;
        for (const d of items) {
          const rawId = rawIdBySourceItemId.get(d.item.source_item_id);
          if (!rawId || stagedRawIds.has(rawId)) continue; // sem raw / ignoreDuplicates
          stagedRawIds.add(rawId);
          staged.push(d);
          count++;
        }
        return count;
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

  // Revisão r0 (MEDIO): verificado depois de CADA teste — cobre as duas
  // execuções do beforeAll e qualquer execução feita dentro de um teste
  // (dry-run, duplicados), mesmo que a excepção do guarda seja engolida.
  afterEach(() => {
    expect(supabaseGuards.getSupabaseClient).not.toHaveBeenCalled();
    expect(supabaseGuards.createClient).not.toHaveBeenCalled();
  });

  it('nenhum caminho cria cliente Supabase', () => {
    expect(supabaseGuards.getSupabaseClient).not.toHaveBeenCalled();
    expect(supabaseGuards.createClient).not.toHaveBeenCalled();
  });

  it('contagens por fonte no resumo do orquestrador e nos repositórios', () => {
    const counts = Object.fromEntries(
      Object.entries(first.summaries).map(([k, s]) => [k, [s.rawItemsCollected, s.rawItemsPersisted, s.stagedItems, s.rawItemsErrored]]),
    );
    // [recolhidos, gravados raw, staged, descartes do collector]. Descartes
    // = posts sem NENHUM item; um item gerado sem data não é descarte.
    expect(counts).toEqual({
      prefeitura_cabo_frio: [3, 3, 3, 1],
      prefeitura_sao_pedro_da_aldeia: [2, 2, 2, 0],
      prefeitura_rio_das_ostras: [2, 2, 2, 1],
      prefeitura_buzios: [1, 1, 1, 1],
    });
    // Nunca há mais descartes do que posts recolhidos, e o detalhe por classe soma o total.
    for (const s of Object.values(first.summaries)) {
      const byReason = Object.values(s.rawItemsErroredByReason ?? {}).reduce((a, b) => a + b, 0);
      expect(byReason).toBe(s.rawItemsErrored);
    }
    expect(first.summaries['prefeitura_rio_das_ostras']!.rawItemsErroredByReason).toEqual({ no_extractable_schedule_found: 1 });
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

  it('datas sem ano: ano inferido pela publicação com dia da semana validado; "Em cartaz até…" fica sem data, para revisão', () => {
    const structured = (k: string) =>
      first.raw.filter((i) => i.source_key === k && i.raw_payload['extraction_method'] === 'structured_block');
    // "Data: Domingo, 8 de novembro" (publicado 06/11/2026) e "Data: Quarta-feira (17/06)" (publicado 10/06/2026).
    expect(structured('prefeitura_rio_das_ostras').map((i) => i.occurrences.map((o) => o.date))).toEqual([['2026-11-08'], []]);
    expect(structured('prefeitura_sao_pedro_da_aldeia').map((i) => i.occurrences.map((o) => o.date))).toEqual([['2026-06-17']]);
    // O item sem data leva o motivo de revisão, mas NÃO conta como erro/descarte do collector.
    const semData = structured('prefeitura_rio_das_ostras')[1]!;
    expect(semData.raw_payload['review_reasons']).toEqual(['structured_subevent_missing_date']);
    expect(first.errorsBySource['prefeitura_rio_das_ostras']!.some((m) => m.includes('structured_subevent_missing_date'))).toBe(false);
    // Nenhuma ocorrência fora do que as fixtures dizem literalmente.
    const allDates = first.raw.flatMap((i) => i.occurrences.map((o) => o.date)).sort();
    expect(allDates).toEqual(['2026-06-17', '2026-06-26', '2026-06-26', '2026-06-28', '2026-10-21', '2026-11-08']);
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
    expect(totals.with_date).toEqual({ count: 6, pct: 75 });
    expect(totals.duplicates).toEqual({ count: 0, pct: 0 });
    expect(totals.publication_delay.items_with_published_at).toBe(8);
    expect(by_group.map((g) => [g.source_key, g.total_items, g.with_date.count])).toEqual([
      ['prefeitura_buzios', 1, 1],
      ['prefeitura_cabo_frio', 3, 3],
      ['prefeitura_rio_das_ostras', 2, 1],
      ['prefeitura_sao_pedro_da_aldeia', 2, 1],
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

  it('dry-run do orquestrador não toca em nenhum repositório (qualquer acesso falha e fica registado)', async () => {
    const accesses: string[] = [];
    const trap = (path: string): unknown =>
      new Proxy(() => undefined, {
        get: (_t, prop) => {
          accesses.push(`${path}.${String(prop)}`);
          throw new Error(`L7: dry-run acedeu a ${path}.${String(prop)}`);
        },
        apply: () => {
          accesses.push(`${path}()`);
          throw new Error(`L7: dry-run chamou ${path}()`);
        },
      });
    const repos = trap('repos') as IRepositorySet;
    const config = AVAILABLE_INSTANCES['cabo-frio']!;
    const summary = await new IngestionOrchestrator(repos).runActivityIngestion(
      new WordPressContentCollector(fakeApiClient(loadPosts('cabo-frio')), config),
      config,
      { dryRun: true, sinceDays: SINCE_DAYS },
    );
    expect(summary).toMatchObject({ dryRun: true, ingestionRunId: null, rawItemsCollected: 3, rawItemsPersisted: 0, stagedItems: 0 });
    expect(accesses).toEqual([]);
  });

  it('post repetido na mesma execução: a chave de conflito real grava-o uma só vez (raw e staging)', async () => {
    const { repos, raw, staged } = memoryRepos();
    const config = AVAILABLE_INSTANCES['cabo-frio']!;
    const posts = loadPosts('cabo-frio');
    const summary = await new IngestionOrchestrator(repos).runActivityIngestion(
      new WordPressContentCollector(fakeApiClient([...posts, posts[0]!]), config),
      config,
      { sinceDays: SINCE_DAYS },
    );
    expect(summary).toMatchObject({ rawItemsCollected: 4, rawItemsPersisted: 3, stagedItems: 3 });
    expect(raw).toHaveLength(3);
    expect(staged).toHaveLength(3);
  });

  it('a mesma fonte em duas execuções (run ids distintos) grava as linhas de cada execução, como a chave real permite', async () => {
    const { repos, raw, runs } = memoryRepos();
    const config = AVAILABLE_INSTANCES['buzios']!;
    const orchestrator = new IngestionOrchestrator(repos);
    for (let n = 0; n < 2; n++) {
      await orchestrator.runActivityIngestion(new WordPressContentCollector(fakeApiClient(loadPosts('buzios')), config), config, { sinceDays: SINCE_DAYS });
    }
    expect(runs.map((r) => r.id)).toEqual(['run-1', 'run-2']);
    expect(raw).toHaveLength(2);
    expect(raw[0]).toEqual(raw[1]);
  });
});
