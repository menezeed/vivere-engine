/**
 * E5 — o modo real da CLI (defaultDeps) passa pelo caminho existente
 * RepositoryFactory.forSupabase → getSupabaseClient (REAL) → envGuard.
 * Só createClient é substituído (falha se for chamado). Com o ambiente
 * vazio ou a apontar para produção, a guarda recusa ANTES de criar o
 * cliente e antes de qualquer pedido às fontes. Nenhuma ligação real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const guards = vi.hoisted(() => ({
  createClient: vi.fn(() => {
    throw new Error('E5: createClient() não pode ser chamado neste teste');
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: guards.createClient }));

import { runRegionIngestion } from '../runRegionIngestion';
import { defaultDeps, parseIngestRegionArgs } from '../../../scripts/ingest-region';
import { _resetSupabaseClient } from '../../persistence/client/supabase';
import { ENV_VAR_NAMES } from '../../lib/envGuard';

const NAMES = Object.values(ENV_VAR_NAMES);
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
  _resetSupabaseClient();
});

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
  _resetSupabaseClient();
  expect(guards.createClient).not.toHaveBeenCalled();
});

describe('ingest-region — modo real passa pelo envGuard', () => {
  it('ambiente vazio → EnvGuardError antes de createClient e antes de pedir as fontes', async () => {
    const createApiClient = vi.fn(defaultDeps.createApiClient);
    await expect(runRegionIngestion('cabo_frio', { dryRun: false }, { ...defaultDeps, createApiClient })).rejects.toMatchObject({
      name: 'EnvGuardError',
      message: expect.stringMatching(/^\[envGuard:/),
    });
    expect(createApiClient).not.toHaveBeenCalled();
  });

  it('VIVERE_ENV=production → bloqueado pela guarda', async () => {
    process.env[ENV_VAR_NAMES.environment] = 'production';
    const createApiClient = vi.fn(defaultDeps.createApiClient);
    await expect(runRegionIngestion('cabo_frio', { dryRun: false }, { ...defaultDeps, createApiClient })).rejects.toMatchObject({
      name: 'EnvGuardError',
    });
    expect(createApiClient).not.toHaveBeenCalled();
  });

  it('dry-run com as dependências da CLI não cria repositórios (nem chega à guarda)', async () => {
    const createRepos = vi.fn(defaultDeps.createRepos);
    const createApiClient = vi.fn(() => ({ fetchPosts: async () => ({ posts: [], totalPages: 1 }) }) as never);
    const result = await runRegionIngestion('buzios', { dryRun: true }, { ...defaultDeps, createRepos, createApiClient });
    expect(createRepos).not.toHaveBeenCalled();
    expect(result.sources[0]!.status).toBe('success');
  });
});

describe('parseIngestRegionArgs', () => {
  it('aceita --region <key> e --region=<key>, --dry-run, --since-days e --json', () => {
    expect(parseIngestRegionArgs(['--region', 'buzios', '--dry-run'])).toEqual({ region: 'buzios', dryRun: true, sinceDays: undefined, json: false });
    expect(parseIngestRegionArgs(['--region=cabo_frio', '--since-days=30', '--json'])).toEqual({ region: 'cabo_frio', dryRun: false, sinceDays: 30, json: true });
  });

  it('erros de uso explícitos', () => {
    expect(() => parseIngestRegionArgs([])).toThrow(/falta --region/);
    expect(() => parseIngestRegionArgs(['--region', '--dry-run'])).toThrow(/falta --region/);
    expect(() => parseIngestRegionArgs(['--region=x', '--since-days=0'])).toThrow(/inteiro positivo/);
    expect(() => parseIngestRegionArgs(['--region=x', '--prod'])).toThrow(/desconhecido/);
  });
});
