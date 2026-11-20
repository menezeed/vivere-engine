/**
 * Fakes partilhados pelos testes do E4: repositórios em memória com as
 * chaves de conflito REAIS (raw_activity_items: source_key +
 * source_item_id + ingestion_run_id; activities_staging:
 * raw_activity_item_id), clientes WordPress com fixtures e um ambiente
 * falso. Sem rede, sem BD.
 */
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { AVAILABLE_INSTANCES } from '../../../collectors/wordpress-content/config/registry';
import type { WordPressApiClient, WordPressPost, FetchPostsResult } from '../../../collectors/wordpress-content/WordPressApiClient';
import type { IRepositorySet } from '../../../persistence/types/repositoryInterfaces';
import type { RawActivityItem } from '../../../types/RawActivityItem';
import type { EnvGuardResult } from '../../../lib/envGuard';

export const NOW = '2026-11-14T12:00:00.000Z';
export const SINCE_DAYS = 200;

export const BASE_URL_TO_FIXTURE = new Map(
  (['cabo-frio', 'sao-pedro-da-aldeia', 'rio-das-ostras', 'buzios'] as const).map((k) => [AVAILABLE_INSTANCES[k]!.base_url, k]),
);

export function loadPosts(instance: string): WordPressPost[] {
  const url = new URL(`../../../collectors/wordpress-content/__tests__/fixtures/${instance}.posts.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as WordPressPost[];
}

export interface MemoryStore {
  raw: Map<string, { id: string; item: RawActivityItem }>;
  staged: Map<string, RawActivityItem>; // raw_activity_item_id → item
  runs: string[];
}

/**
 * Repositórios em memória. `runIds` permite fixar os ids devolvidos por
 * ingestionRun.start() (por omissão run-1, run-2, ...).
 */
export function memoryRepos(runIds?: () => string): { repos: IRepositorySet; store: MemoryStore } {
  const store: MemoryStore = { raw: new Map(), staged: new Map(), runs: [] };
  let seq = 0;
  const repos: IRepositorySet = {
    ingestionRun: {
      start: async () => {
        const id = runIds ? runIds() : `run-${++seq}`;
        store.runs.push(id);
        return id;
      },
      finish: async () => undefined,
      markFailed: async () => undefined,
    },
    rawVenueItem: { insertBatch: async () => { throw new Error('venues fora do E4'); } },
    venueStaging: { insertBatch: async () => { throw new Error('venues fora do E4'); } },
    rawActivityItem: {
      // ON CONFLICT (source_key, source_item_id, ingestion_run_id) DO NOTHING; devolve só os inseridos.
      insertBatch: async (items, runId) => {
        const out: Array<{ id: string; source_item_id: string }> = [];
        for (const i of items) {
          const key = `${i.source_key}|${i.source_item_id}|${runId}`;
          if (store.raw.has(key)) continue;
          const id = `raw-${store.raw.size + 1}`;
          store.raw.set(key, { id, item: i });
          out.push({ id, source_item_id: i.source_item_id });
        }
        return out;
      },
    },
    activityStaging: {
      // ON CONFLICT (raw_activity_item_id) DO NOTHING.
      insertBatch: async (items, persisted) => {
        let n = 0;
        for (const d of items) {
          const p = persisted.find((x) => x.source_item_id === d.item.source_item_id);
          if (!p || store.staged.has(p.id)) continue;
          store.staged.set(p.id, d.item);
          n++;
        }
        return n;
      },
    },
  };
  return { repos, store };
}

export function fixtureClient(baseUrl: string): WordPressApiClient {
  const fixture = BASE_URL_TO_FIXTURE.get(baseUrl);
  if (!fixture) throw new Error(`sem fixture para ${baseUrl}`);
  return { fetchPosts: async (): Promise<FetchPostsResult> => ({ posts: loadPosts(fixture), totalPages: 1 }) } as unknown as WordPressApiClient;
}

export const STAGING_ENV_RESULT: EnvGuardResult = Object.freeze({
  environment: 'staging',
  projectRef: 'xxxxxxxxxxxxxxxxxxxx',
  supabaseUrl: 'https://xxxxxxxxxxxxxxxxxxxx.supabase.co',
  serviceKeyFormat: 'sb_secret',
  serviceKeyProjectBinding: 'unverified',
  warnings: [],
});

export const noSleep = vi.fn(async () => undefined);
