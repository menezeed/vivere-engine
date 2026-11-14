/**
 * src/ingestion/runRegionIngestion.ts
 *
 * E5 — ingestão de UMA região (src/config/regions.ts), ponta a ponta:
 *   fontes WordPress da região → WordPressContentCollector →
 *   IngestionOrchestrator (ADR-0013, idempotente) → relatório L4 →
 *   saúde E7.
 *
 * Regras:
 *  - Só fontes WordPress. Google Places (API paga) é RECUSADO
 *    explicitamente até existir o orçamento persistente (L5); aparece em
 *    refused_sources, nunca é chamado.
 *  - dry-run: o orquestrador não toca em repositórios e createRepos()
 *    NÃO é chamado — nenhum cliente Supabase é criado.
 *  - modo real: createRepos() é chamado ANTES de qualquer pedido às
 *    fontes (falha cedo). O default da CLI é RepositoryFactory.forSupabase
 *    → getSupabaseClient → envGuard (só staging; produção bloqueada).
 *  - Todas as dependências com efeitos (repositórios, cliente HTTP,
 *    relógio) são injectadas — os testes usam memória, sem rede nem BD.
 *  - Uma fonte que falha não interrompe as outras; fica como execução
 *    'failed' no relatório E7.
 */
import { getRegion, GOOGLE_PLACES_SOURCE_KEY, type RegionDefinition } from '../config/regions';
import { getWordPressSourceConfigBySourceKey } from '../collectors/wordpress-content/config/registry';
import type { WordPressContentSourceConfig } from '../collectors/wordpress-content/config/WordPressContentSourceConfig';
import { WordPressContentCollector } from '../collectors/wordpress-content/WordPressContentCollector';
import type { WordPressApiClient, FetchPostsParams, FetchPostsResult } from '../collectors/wordpress-content/WordPressApiClient';
import { IngestionOrchestrator } from '../persistence/orchestration/IngestionOrchestrator';
import type { IRepositorySet } from '../persistence/types/repositoryInterfaces';
import type { IngestionSummary } from '../persistence/types/persistenceTypes';
import { parseWordPressGmtDate } from '../lib/wordpressDates';
import { computeRunQualityMetrics, type RunQualityReport } from '../pipeline/metrics/runQualityMetrics';
import {
  evaluateSourceHealth,
  type SourceHealthReport,
  type SourceHealthThresholds,
  type SourceRunInfo,
} from '../pipeline/health/sourceHealth';
import type { RawActivityItem } from '../types/RawActivityItem';

export interface RegionIngestionDeps {
  /** Só chamado fora de dry-run, antes de qualquer pedido às fontes. */
  createRepos: () => Promise<IRepositorySet> | IRepositorySet;
  createApiClient: (baseUrl: string) => WordPressApiClient;
  /** ISO 8601. Relógio injectado (início/fim das execuções, relatórios). */
  now: () => string;
}

export interface RegionIngestionOptions {
  dryRun: boolean;
  sinceDays?: number;
  /** Relatório L4 da execução anterior da região (para volume_drop). */
  previousReport?: RunQualityReport | null;
  healthThresholds?: Partial<SourceHealthThresholds>;
}

export interface RefusedSource {
  source_key: string;
  reason: string;
}

export interface SourceOutcome {
  source_key: string;
  instance: string;
  status: 'success' | 'failed';
  summary: IngestionSummary | null;
  error: string | null;
}

export interface RegionIngestionResult {
  region: string;
  dry_run: boolean;
  sources: SourceOutcome[];
  refused_sources: RefusedSource[];
  quality: RunQualityReport;
  health: SourceHealthReport;
}

export class RegionIngestionError extends Error {
  constructor(message: string) {
    super(`[ingest-region] ${message}`);
    this.name = 'RegionIngestionError';
  }
}

interface PlannedSource {
  sourceKey: string;
  config: WordPressContentSourceConfig;
}

/** Separa as fontes da região em WordPress executáveis e recusadas. Pura. */
export function planRegionSources(region: RegionDefinition): { planned: PlannedSource[]; refused: RefusedSource[] } {
  const planned: PlannedSource[] = [];
  const refused: RefusedSource[] = [];
  for (const sourceKey of region.sources) {
    if (sourceKey === GOOGLE_PLACES_SOURCE_KEY) {
      refused.push({ source_key: sourceKey, reason: 'API paga: fora da ingestão por região até existir o orçamento persistente (L5)' });
      continue;
    }
    const config = getWordPressSourceConfigBySourceKey(sourceKey);
    if (!config) {
      refused.push({ source_key: sourceKey, reason: 'fonte não registada no registry WordPress' });
      continue;
    }
    planned.push({ sourceKey, config });
  }
  return { planned, refused };
}

/** Cliente que regista a data (UTC) de cada post visto, sem alterar o resultado. */
function recordingClient(inner: WordPressApiClient, onPost: (id: number, iso: string) => void): WordPressApiClient {
  return {
    fetchPosts: async (params: FetchPostsParams): Promise<FetchPostsResult> => {
      const result = await inner.fetchPosts(params);
      for (const p of result.posts) {
        const d = parseWordPressGmtDate(p.date_gmt);
        if (!Number.isNaN(d.getTime())) onPost(p.id, d.toISOString());
      }
      return result;
    },
  } as unknown as WordPressApiClient;
}

/** Em dry-run o orquestrador não toca em repositórios; qualquer acesso é um erro. */
function noRepositories(): IRepositorySet {
  return new Proxy({} as IRepositorySet, {
    get: (_t, prop) => {
      throw new RegionIngestionError(`dry-run tentou aceder a repositórios (${String(prop)})`);
    },
  });
}

export async function runRegionIngestion(
  regionKey: string,
  options: RegionIngestionOptions,
  deps: RegionIngestionDeps,
): Promise<RegionIngestionResult> {
  let region: RegionDefinition;
  try {
    region = getRegion(regionKey);
  } catch (err) {
    throw new RegionIngestionError(err instanceof Error ? err.message : String(err));
  }

  const { planned, refused } = planRegionSources(region);
  if (planned.length === 0) {
    throw new RegionIngestionError(
      `região "${regionKey}" não tem fontes WordPress executáveis` +
        (refused.length ? ` (recusadas: ${refused.map((r) => r.source_key).join(', ')})` : ''),
    );
  }

  // Modo real: repositórios (e, por omissão, envGuard) ANTES de qualquer pedido às fontes.
  const repos = options.dryRun ? noRepositories() : await deps.createRepos();
  const orchestrator = new IngestionOrchestrator(repos);

  const items: RawActivityItem[] = [];
  const publishedAt = new Map<string, string>(); // `${source_key}:${post_id}` → ISO
  const lastPublishedAt: Record<string, string | null> = {};
  const runs: SourceRunInfo[] = [];
  const outcomes: SourceOutcome[] = [];

  for (const { sourceKey, config } of planned) {
    lastPublishedAt[sourceKey] = null;
    const client = recordingClient(deps.createApiClient(config.base_url), (id, iso) => {
      publishedAt.set(`${sourceKey}:${id}`, iso);
      const last = lastPublishedAt[sourceKey];
      if (!last || iso > last) lastPublishedAt[sourceKey] = iso;
    });
    const collector = new WordPressContentCollector(client, config);
    const collect = collector.collect.bind(collector);
    collector.collect = async (opts) => {
      const result = await collect(opts);
      items.push(...result.items);
      return result;
    };

    const startedAt = deps.now();
    try {
      const summary = await orchestrator.runActivityIngestion(collector, config, {
        dryRun: options.dryRun,
        sinceDays: options.sinceDays,
      });
      runs.push({ source_key: sourceKey, status: 'success', started_at: startedAt, finished_at: deps.now() });
      outcomes.push({ source_key: sourceKey, instance: config.display_name, status: 'success', summary, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      runs.push({ source_key: sourceKey, status: 'failed', started_at: startedAt, finished_at: deps.now(), error_message: message });
      outcomes.push({ source_key: sourceKey, instance: config.display_name, status: 'failed', summary: null, error: message });
    }
  }

  const generatedAt = deps.now();
  const quality = computeRunQualityMetrics(items, {
    runId: `region:${regionKey}`,
    generatedAt,
    resolvePublishedAt: (i) => publishedAt.get(`${i.source_key}:${String(i.raw_payload['wp_post_id'])}`) ?? null,
  });
  const health = evaluateSourceHealth({
    current: quality,
    previous: options.previousReport ?? null,
    runs,
    lastPublishedAt,
    expectedSources: planned.map((p) => p.sourceKey),
    now: generatedAt,
    thresholds: options.healthThresholds,
  });

  return { region: regionKey, dry_run: options.dryRun, sources: outcomes, refused_sources: refused, quality, health };
}
