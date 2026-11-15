/**
 * E4 — execução assistida ponta a ponta com fakes (sem rede, sem BD):
 * manifesto, lock, retry, códigos de saída, idempotência e varrimento
 * de segredos no manifesto serializado.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const guards = vi.hoisted(() => ({
  getSupabaseClient: vi.fn(() => {
    throw new Error('E4: getSupabaseClient() não pode ser chamado neste teste');
  }),
  createClient: vi.fn(() => {
    throw new Error('E4: createClient() não pode ser chamado neste teste');
  }),
}));
vi.mock('../../../persistence/client/supabase', () => ({ getSupabaseClient: guards.getSupabaseClient, _resetSupabaseClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: guards.createClient }));

import { runAssistedIngestion, makeRunId, EXIT_OK, EXIT_SOURCE_FAILED, EXIT_REFUSED, type AssistedRunArgs, type AssistedRunDeps } from '../runAssisted';
import { readRunManifests, writeRunManifest, serializeRunManifest, sanitizeText, FORBIDDEN_MANIFEST_PATTERNS, UnsafeManifestError, type RunManifest } from '../runManifest';
import { acquireRegionLock } from '../runLock';
import { runPreflight } from '../preflight';
import { IngestionOrchestrator } from '../../../persistence/orchestration/IngestionOrchestrator';
import { WordPressContentCollector } from '../../../collectors/wordpress-content/WordPressContentCollector';
import { getWordPressSourceConfigBySourceKey, AVAILABLE_INSTANCES } from '../../../collectors/wordpress-content/config/registry';
import type { WordPressApiClient } from '../../../collectors/wordpress-content/WordPressApiClient';
import type { RegionDefinition } from '../../../config/regions';
import { REGIONS } from '../../../config/regions';
import { NOW, SINCE_DAYS, memoryRepos, fixtureClient, STAGING_ENV_RESULT } from './fakes';

let tmp: string;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e4-run-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  expect(guards.getSupabaseClient).not.toHaveBeenCalled();
  expect(guards.createClient).not.toHaveBeenCalled();
});

const DUAS: RegionDefinition = {
  key: 'duas_fontes',
  city_label: 'Teste RJ',
  city: 'Teste',
  state: 'RJ',
  center: null,
  radius_m: null,
  sources: ['prefeitura_cabo_frio', 'prefeitura_buzios', 'google_places'],
};

function makeDeps(over: Partial<AssistedRunDeps> & { repos?: ReturnType<typeof memoryRepos> } = {}) {
  const memory = over.repos ?? memoryRepos();
  const sleep = vi.fn(async (_ms: number) => undefined);
  let n = 0;
  const deps: AssistedRunDeps = {
    ingestion: { createRepos: vi.fn(() => memory.repos), createApiClient: vi.fn(fixtureClient), now: () => NOW },
    preflight: {
      assertEnvironment: vi.fn(() => STAGING_ENV_RESULT),
      gitStatusPorcelain: () => '',
      previousManifests: () => readRunManifests(path.join(tmp, 'manifests')),
      now: () => NOW,
    },
    regions: [...REGIONS, DUAS],
    manifestsDir: path.join(tmp, 'manifests'),
    locksDir: path.join(tmp, 'locks'),
    gitCommit: () => '0123456789abcdef0123456789abcdef01234567',
    randomSuffix: () => `s${++n}`,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 20 },
    sleep,
    lock: { isProcessAlive: () => true },
    ...over,
  };
  return { deps, memory, sleep };
}

const args = (over: Partial<AssistedRunArgs> = {}): AssistedRunArgs => ({
  region: 'cabo_frio',
  dryRun: false,
  allowPaid: false,
  forceRerun: false,
  preflightOnly: false,
  sinceDays: SINCE_DAYS,
  ...over,
});

function readManifestFile(p: string | null): RunManifest {
  return JSON.parse(fs.readFileSync(p!, 'utf8')) as RunManifest;
}

describe('runAssistedIngestion — manifesto', () => {
  it('execução real ok: manifesto auditável completo, lock libertado, código 0', async () => {
    const { deps, memory } = makeDeps();
    const out = await runAssistedIngestion(args(), deps);
    expect(out.exitCode).toBe(EXIT_OK);
    const m = readManifestFile(out.manifestPath);
    expect(path.dirname(out.manifestPath!)).toBe(path.join(tmp, 'manifests'));
    expect(m).toMatchObject({
      schema_version: 1,
      run_id: makeRunId(NOW, 'cabo_frio', 's1'),
      started_at: NOW,
      finished_at: NOW,
      git: { commit: '0123456789abcdef0123456789abcdef01234567', dirty: false },
      region: 'cabo_frio',
      dry_run: false,
      target_environment: 'staging',
      since_days: SINCE_DAYS,
      sources_attempted: ['prefeitura_cabo_frio'],
      outcome: 'ok',
      exit_code: 0,
      reason: null,
    });
    expect(m.run_id).toBe('20261114T120000Z_cabo_frio_s1');
    expect(m.sources).toEqual([
      expect.objectContaining({ source_key: 'prefeitura_cabo_frio', status: 'ok', retries: 0, counts: { collected: 3, persisted: 3, staged: 3, discarded: expect.any(Number) }, ingestion_run_id: 'run-1' }),
      expect.objectContaining({ source_key: 'google_places', status: 'skipped', skip_reason: expect.stringContaining('L5') }),
    ]);
    expect(m.totals).toMatchObject({ sources_ok: 1, sources_failed: 0, sources_skipped: 1, collected: 3, persisted: 3, staged: 3 });
    expect(m.quality?.totals.total_items).toBe(3);
    expect(m.health?.status).toBeDefined();
    expect(m.preflight.map((c) => c.id)).toEqual(['region_exists', 'sources', 'env_target', 'git_clean', 'rerun_window']);
    expect(memory.store.raw.size).toBe(3);
    expect(fs.readdirSync(path.join(tmp, 'locks'))).toEqual([]);
    expect(out.text).toContain('resultado: OK (código 0)');
  });

  it('dry-run: sem repositórios, sem envGuard, target_environment null', async () => {
    const { deps } = makeDeps();
    const out = await runAssistedIngestion(args({ dryRun: true }), deps);
    expect(out.exitCode).toBe(EXIT_OK);
    expect(deps.ingestion.createRepos).not.toHaveBeenCalled();
    expect(deps.preflight.assertEnvironment).not.toHaveBeenCalled();
    expect(readManifestFile(out.manifestPath)).toMatchObject({ dry_run: true, target_environment: null, outcome: 'ok' });
  });

  it('--preflight: só o checklist — nada corre, sem lock nem manifesto', async () => {
    const { deps } = makeDeps();
    const out = await runAssistedIngestion(args({ preflightOnly: true }), deps);
    expect(out.exitCode).toBe(EXIT_OK);
    expect(out.manifest).toBeNull();
    expect(deps.ingestion.createApiClient).not.toHaveBeenCalled();
    expect(deps.ingestion.createRepos).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmp, 'manifests'))).toBe(false);
    expect(out.text).toContain('O que correria');
  });

  it('pré-voo recusado (produção): manifesto refused, código 3, nada executado', async () => {
    const { deps } = makeDeps();
    deps.preflight.assertEnvironment = () => {
      throw Object.assign(new Error('[envGuard:PRODUCTION_BLOCKED] x'), { code: 'PRODUCTION_BLOCKED' });
    };
    const out = await runAssistedIngestion(args(), deps);
    expect(out.exitCode).toBe(EXIT_REFUSED);
    expect(deps.ingestion.createRepos).not.toHaveBeenCalled();
    expect(deps.ingestion.createApiClient).not.toHaveBeenCalled();
    expect(readManifestFile(out.manifestPath)).toMatchObject({ outcome: 'refused', exit_code: 3, target_environment: null, reason: expect.stringContaining('env_target') });
  });

  it('--preflight com região desconhecida → código 3', async () => {
    const out = await runAssistedIngestion(args({ region: 'atlantida', preflightOnly: true }), makeDeps().deps);
    expect(out.exitCode).toBe(EXIT_REFUSED);
    expect(out.text).toContain('RECUSADO');
  });
});

describe('runAssistedIngestion — lock', () => {
  it('lock da região ocupado → recusado (código 3) sem tocar em fontes nem repositórios', async () => {
    const { deps } = makeDeps();
    const held = acquireRegionLock({ dir: deps.locksDir, region: 'cabo_frio', runId: 'outra', pid: 42, nowMs: () => Date.parse(NOW), isProcessAlive: () => true });
    const out = await runAssistedIngestion(args(), deps);
    expect(out.exitCode).toBe(EXIT_REFUSED);
    expect(deps.ingestion.createRepos).not.toHaveBeenCalled();
    expect(readManifestFile(out.manifestPath).reason).toContain('execução em curso');
    held.release();
  });

  it('o lock é libertado mesmo quando a execução rebenta (createRepos falha)', async () => {
    const { deps } = makeDeps();
    deps.ingestion.createRepos = () => {
      throw Object.assign(new Error('[envGuard:KEY_MISSING] SUPABASE_SERVICE_KEY é obrigatória.'), { name: 'EnvGuardError' });
    };
    const out = await runAssistedIngestion(args(), deps);
    expect(out.exitCode).toBe(EXIT_SOURCE_FAILED);
    expect(readManifestFile(out.manifestPath)).toMatchObject({ outcome: 'error', reason: '[env_guard] KEY_MISSING' });
    expect(fs.readdirSync(deps.locksDir)).toEqual([]);
  });
});

describe('runAssistedIngestion — falhas e retry', () => {
  const caboFrioUrl = AVAILABLE_INSTANCES['cabo-frio']!.base_url;

  it('fonte com 503 persistente: retries limitados, failed + http_transient; a outra fonte grava; código 1', async () => {
    const { deps, memory, sleep } = makeDeps();
    const failing = vi.fn(async () => {
      throw new Error(`WordPress REST API falhou (503) em ${caboFrioUrl}/wp-json/wp/v2/posts?categories=1: <html>erro</html>`);
    });
    deps.ingestion.createApiClient = vi.fn((url: string) => (url === caboFrioUrl ? ({ fetchPosts: failing } as unknown as WordPressApiClient) : fixtureClient(url)));
    const out = await runAssistedIngestion(args({ region: 'duas_fontes' }), deps);
    expect(out.exitCode).toBe(EXIT_SOURCE_FAILED);
    expect(failing).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
    const m = readManifestFile(out.manifestPath);
    const cf = m.sources.find((s) => s.source_key === 'prefeitura_cabo_frio')!;
    const host = new URL(caboFrioUrl).hostname;
    expect(cf).toMatchObject({ status: 'failed', error_class: 'http_transient', http_status: 503, error_host: host, retries: 2, counts: null });
    expect(cf).not.toHaveProperty('error_message');
    const raw = fs.readFileSync(out.manifestPath!, 'utf8');
    // Nem o corpo da resposta nem o caminho/query do pedido chegam ao manifesto (incluindo o E7).
    for (const leak of ['<html>', 'erro</html>', 'categories=', '/wp-json', 'https://']) expect(raw).not.toContain(leak);
    expect(m.sources.find((s) => s.source_key === 'prefeitura_buzios')).toMatchObject({ status: 'ok' });
    expect(m.outcome).toBe('failed');
    expect([...memory.store.raw.values()].map((r) => r.item.source_key)).toEqual(['prefeitura_buzios']);
    expect(out.text).toContain(`FALHOU  prefeitura_cabo_frio: [http_transient] HTTP 503 @ ${host}`);
  });

  it('503 transitório seguido de sucesso: fonte ok com retries contados', async () => {
    const { deps } = makeDeps();
    const inner = fixtureClient(caboFrioUrl);
    let calls = 0;
    deps.ingestion.createApiClient = vi.fn(() => ({
      fetchPosts: async (p: Parameters<WordPressApiClient['fetchPosts']>[0]) => {
        if (++calls === 1) throw new Error('WordPress REST API falhou (503)');
        return inner.fetchPosts(p);
      },
    }) as unknown as WordPressApiClient);
    const out = await runAssistedIngestion(args(), deps);
    expect(out.exitCode).toBe(EXIT_OK);
    expect(readManifestFile(out.manifestPath).sources[0]).toMatchObject({ status: 'ok', retries: 1 });
  });

  it('404 não é repetido', async () => {
    const { deps, sleep } = makeDeps();
    const failing = vi.fn(async () => {
      throw new Error('WordPress REST API falhou (404)');
    });
    deps.ingestion.createApiClient = vi.fn(() => ({ fetchPosts: failing }) as unknown as WordPressApiClient);
    const out = await runAssistedIngestion(args(), deps);
    expect(out.exitCode).toBe(EXIT_SOURCE_FAILED);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(readManifestFile(out.manifestPath).sources[0]).toMatchObject({ error_class: 'http_permanent', retries: 0 });
  });
});

describe('idempotência', () => {
  it('repositórios: reexecutar o MESMO lote no mesmo ingestion_run é um no-op (chaves de conflito reais)', async () => {
    const memory = memoryRepos(() => 'run-fixo');
    const config = getWordPressSourceConfigBySourceKey('prefeitura_cabo_frio')!;
    const orchestrator = new IngestionOrchestrator(memory.repos);
    const collector = () => new WordPressContentCollector(fixtureClient(config.base_url), config);

    const first = await orchestrator.runActivityIngestion(collector(), config, { sinceDays: SINCE_DAYS });
    const rawAfterFirst = new Map(memory.store.raw);
    const stagedAfterFirst = new Map(memory.store.staged);
    const second = await orchestrator.runActivityIngestion(collector(), config, { sinceDays: SINCE_DAYS });

    expect(first).toMatchObject({ rawItemsCollected: 3, rawItemsPersisted: 3, stagedItems: 3 });
    expect(second).toMatchObject({ rawItemsCollected: 3, rawItemsPersisted: 0, stagedItems: 0 });
    expect(memory.store.raw).toEqual(rawAfterFirst);
    expect(memory.store.staged).toEqual(stagedAfterFirst);
  });

  it('execução assistida repetida na mesma janela: a 2.ª é recusada pelo pré-voo e não toca nos repositórios', async () => {
    const { deps, memory } = makeDeps();
    const first = await runAssistedIngestion(args(), deps);
    expect(first.exitCode).toBe(EXIT_OK);
    const rawAfterFirst = new Map(memory.store.raw);
    (deps.ingestion.createRepos as ReturnType<typeof vi.fn>).mockClear();

    const second = await runAssistedIngestion(args(), deps);
    expect(second.exitCode).toBe(EXIT_REFUSED);
    expect(deps.ingestion.createRepos).not.toHaveBeenCalled();
    expect(memory.store.raw).toEqual(rawAfterFirst);
    expect(second.manifest!.preflight.find((c) => c.id === 'rerun_window')).toMatchObject({ status: 'fail', detail: expect.stringContaining(first.manifest!.run_id) });
  });

  it('interleaving: B passa o pré-voo enquanto A corre; A termina; B adquire o lock → recusado na revalidação', async () => {
    const { deps, memory } = makeDeps();
    const realPrevious = deps.preflight.previousManifests;
    let calls = 0;
    // 1.ª leitura de B = antes de A terminar (nenhum manifesto ainda); as seguintes já vêem o de A.
    const depsB: AssistedRunDeps = { ...deps, preflight: { ...deps.preflight, previousManifests: () => (++calls === 1 ? [] : realPrevious()) } };
    const preB = runPreflight({ region: 'cabo_frio', dryRun: false, allowPaid: false, forceRerun: false }, { ...depsB.preflight });
    expect(preB.ok).toBe(true); // B passaria o pré-voo inicial
    calls = 0;

    const a = await runAssistedIngestion(args(), deps);
    expect(a.exitCode).toBe(EXIT_OK);
    const rawAfterA = new Map(memory.store.raw);
    (deps.ingestion.createRepos as ReturnType<typeof vi.fn>).mockClear();

    const b = await runAssistedIngestion(args(), depsB);
    expect(calls).toBeGreaterThanOrEqual(2); // pré-voo inicial (vazio) + revalidação sob lock
    expect(b.exitCode).toBe(EXIT_REFUSED);
    expect(deps.ingestion.createRepos).not.toHaveBeenCalled();
    expect(memory.store.raw).toEqual(rawAfterA);
    expect(b.manifest).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('revalidação com o lock detido') });
    expect(b.manifest!.preflight.find((c) => c.id === 'rerun_window')).toMatchObject({ status: 'fail', detail: expect.stringContaining(a.manifest!.run_id) });
    expect(fs.readdirSync(deps.locksDir)).toEqual([]);
  });

  it('o manifesto final é gravado ANTES de libertar o lock (ok e erro)', async () => {
    for (const failRepos of [false, true]) {
      const { deps } = makeDeps();
      const lockFile = path.join(deps.locksDir, 'cabo_frio.lock');
      const lockHeldAtWrite: boolean[] = [];
      deps.writeManifest = (dir, m) => {
        lockHeldAtWrite.push(fs.existsSync(lockFile));
        return writeRunManifest(dir, m);
      };
      if (failRepos) deps.ingestion.createRepos = () => { throw new Error('falha inesperada'); };
      // forceRerun: a 1.ª iteração deixou um manifesto real no mesmo directório.
      await runAssistedIngestion(args({ forceRerun: true }), deps);
      expect(lockHeldAtWrite).toEqual([true]);
      expect(fs.existsSync(lockFile)).toBe(false);
    }
  });

  it('limite documentado: com --force-rerun, um ingestion_run novo grava linhas novas (Camada A append-only por execução)', async () => {
    const { deps, memory } = makeDeps();
    await runAssistedIngestion(args(), deps);
    const out = await runAssistedIngestion(args({ forceRerun: true }), deps);
    expect(out.exitCode).toBe(EXIT_OK);
    expect(memory.store.raw.size).toBe(6);
    expect(memory.store.runs).toEqual(['run-1', 'run-2']);
  });
});

describe('manifesto sem segredos', () => {
  // Valores 100% falsos, construídos em runtime (marcados SENTINEL para o gitleaks).
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const SECRET = `sb_secret_KEYSENTINEL${'Z'.repeat(20)}`;
  const JWT = `${b64({ alg: 'HS256' })}.${b64({ role: 'service_role', ref: 'x' })}.SIGSENTINEL0123456789`;
  const TOKEN = 'TOKENSENTINEL0123';

  it('erros com segredos, JWT, apikey= e URLs com token não chegam ao manifesto serializado', async () => {
    const { deps } = makeDeps();
    const previous = { ...process.env };
    process.env['SUPABASE_SERVICE_KEY'] = SECRET; // valor falso: o manifesto nunca lê o ambiente
    try {
      deps.ingestion.createApiClient = vi.fn(() => ({
        fetchPosts: async () => {
          throw new Error(
            `WordPress REST API falhou (401) em https://exemplo.gov.br/wp-json?apikey=${TOKEN}&x=1: key=${SECRET} Authorization: Bearer ${JWT} role service_role`,
          );
        },
      }) as unknown as WordPressApiClient);
      const out = await runAssistedIngestion(args(), deps);
      const raw = fs.readFileSync(out.manifestPath!, 'utf8');
      for (const p of [/sb_secret/i, /eyJ/, /service_role/i, /apikey=/i, /bearer\s+\S{8,}/i, /supabase\.co/i]) expect(raw).not.toMatch(p);
      for (const v of [SECRET, JWT, TOKEN, 'exemplo.gov.br/wp-json']) expect(raw).not.toContain(v);
      expect(out.text).not.toContain(SECRET);
      expect(out.text).not.toContain(TOKEN);
      // nenhum valor de variável de ambiente aparece no manifesto
      for (const v of Object.values(process.env)) if (v && v.length >= 12) expect(raw).not.toContain(v);
    } finally {
      process.env = previous;
    }
  });

  it('serializeRunManifest falha fechado se um padrão proibido sobreviver (por exemplo numa chave)', () => {
    const m = { run_id: 'x', quality: { [`sb_secret_${'A'.repeat(20)}`]: 1 } } as unknown as RunManifest;
    expect(() => serializeRunManifest(m)).toThrow(UnsafeManifestError);
  });

  // Formas com aspas (JSON, cabeçalhos, aspas simples) — valores construídos em runtime.
  const QUOTED_FORMS: Array<[string, string]> = [
    ['JSON compacto', JSON.stringify({ apikey: TOKEN })],
    ['JSON com espaços', `{ "token": "${TOKEN}" }`],
    ['JSON com espaço antes dos dois pontos', `"apikey" : "${TOKEN}"`],
    ['aspas simples', `{'secret': '${TOKEN}'}`],
    ['valor entre aspas com espaços', `"password": "${TOKEN} mais texto"`],
    ['cabeçalho Authorization', `Authorization: Bearer ${TOKEN}`],
    ['cabeçalho JSON', JSON.stringify({ Authorization: `Bearer ${TOKEN}` })],
    ['x-api-key', `x-api-key: ${TOKEN}`],
    ['client_secret=', `client_secret=${TOKEN}`],
    ['JSON escapado (já serializado)', JSON.stringify(JSON.stringify({ access_token: TOKEN }))],
  ];

  it.each(QUOTED_FORMS)('sanitizeText mascara credenciais: %s', (_label, input) => {
    const out = sanitizeText(`corpo: ${input} fim`);
    expect(out).not.toContain(TOKEN);
    for (const p of FORBIDDEN_MANIFEST_PATTERNS) expect(out).not.toMatch(p.re);
  });

  it.each(QUOTED_FORMS)('a verificação final reconhece a forma em bruto (fail-closed): %s', (_label, input) => {
    expect(FORBIDDEN_MANIFEST_PATTERNS.some((p) => p.re.test(input))).toBe(true);
    // Numa chave de objecto (que o sanitizador não altera), a serialização falha.
    const m = { run_id: 'x', quality: { [input]: 1 } } as unknown as RunManifest;
    expect(() => serializeRunManifest(m)).toThrow(UnsafeManifestError);
  });

  it('corpo de resposta JSON com credenciais: nada do corpo chega ao manifesto', async () => {
    const { deps } = makeDeps();
    deps.ingestion.createApiClient = vi.fn(() => ({
      fetchPosts: async () => {
        throw new Error(`WordPress REST API falhou (403) em https://exemplo.gov.br/wp-json/wp/v2/posts: ${QUOTED_FORMS.map((f) => f[1]).join(' ')}`);
      },
    }) as unknown as WordPressApiClient);
    const out = await runAssistedIngestion(args(), deps);
    const raw = fs.readFileSync(out.manifestPath!, 'utf8');
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain('wp-json');
    expect(out.manifest!.sources[0]).toMatchObject({ status: 'failed', error_class: 'http_permanent', http_status: 403, error_host: 'exemplo.gov.br' });
    expect(out.text).not.toContain(TOKEN);
  });

  it('sanitizeText: URL → host; segredos mascarados; texto truncado', () => {
    expect(sanitizeText('falhou em https://a.gov.br/x?token=abc')).toBe('falhou em <url:a.gov.br>');
    expect(sanitizeText(`x ${SECRET} y`)).toBe('x <redacted> y');
    expect(sanitizeText(`apikey=${TOKEN} fim`)).toBe('<redacted-param> fim');
    expect(sanitizeText('a'.repeat(400)).length).toBe(301);
    for (const p of FORBIDDEN_MANIFEST_PATTERNS) expect(sanitizeText(`${SECRET} ${JWT} apikey=1 Bearer ${JWT}`)).not.toMatch(p.re);
  });
});
