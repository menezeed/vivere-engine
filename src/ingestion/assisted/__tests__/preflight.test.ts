/**
 * Pré-voo E4: recusas sem rede. O envGuard REAL é usado com ambientes
 * falsos (objectos literais, nunca process.env).
 */
import { describe, it, expect } from 'vitest';
import { runPreflight, formatPreflight, type PreflightDeps, type PreflightInput } from '../preflight';
import { assertEnvironment } from '../../../lib/envGuard';
import { supabaseUrlFor } from '../../../config/environments';
import type { RunManifest } from '../runManifest';
import { NOW } from './fakes';

const FAKE_STAGING_ENV = {
  VIVERE_ENV: 'staging',
  SUPABASE_URL: supabaseUrlFor('staging'),
  SUPABASE_SERVICE_KEY: `sb_secret_${'F'.repeat(24)}`,
};

function deps(overrides: Partial<PreflightDeps> & { env?: NodeJS.ProcessEnv } = {}): PreflightDeps {
  const env = overrides.env ?? FAKE_STAGING_ENV;
  return {
    assertEnvironment: () => assertEnvironment(env),
    gitStatusPorcelain: () => '',
    previousManifests: () => [],
    now: () => NOW,
    ...overrides,
  };
}

const base: PreflightInput = { region: 'cabo_frio', dryRun: false, allowPaid: false, forceRerun: false };
const failed = (r: ReturnType<typeof runPreflight>) => r.checks.filter((c) => c.status === 'fail').map((c) => c.id);

describe('runPreflight', () => {
  it('caso feliz: staging, árvore limpa, só WordPress (Google Places ignorado)', () => {
    const r = runPreflight(base, deps());
    expect(r.ok).toBe(true);
    expect(r.targetEnvironment).toBe('staging');
    expect(r.runSources).toEqual(['prefeitura_cabo_frio']);
    expect(r.skipped).toEqual([expect.objectContaining({ source_key: 'google_places' })]);
    expect(formatPreflight(r, base)).toContain('fontes: prefeitura_cabo_frio');
  });

  it('recusa alvo de produção (VIVERE_ENV=production)', () => {
    const r = runPreflight(base, deps({ env: { ...FAKE_STAGING_ENV, VIVERE_ENV: 'production' } }));
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === 'env_target')).toMatchObject({ status: 'fail', detail: expect.stringContaining('PRODUCTION_BLOCKED') });
    expect(r.targetEnvironment).toBeNull();
  });

  it('recusa URL de produção e não regista valores do ambiente', () => {
    const r = runPreflight(base, deps({ env: { ...FAKE_STAGING_ENV, SUPABASE_URL: supabaseUrlFor('production') } }));
    expect(failed(r)).toEqual(['env_target']);
    const text = JSON.stringify(r) + formatPreflight(r, base);
    expect(text).not.toContain('supabase.co');
    expect(text).not.toContain('sb_secret_');
  });

  it('recusa ambiente em falta', () => {
    expect(failed(runPreflight(base, deps({ env: {} })))).toEqual(['env_target']);
  });

  it('recusa região desconhecida', () => {
    const r = runPreflight({ ...base, region: 'atlantida' }, deps());
    expect(r.ok).toBe(false);
    expect(failed(r)).toEqual(['region_exists']);
  });

  it('recusa fonte paga seleccionada, mesmo com --allow-paid', () => {
    for (const allowPaid of [false, true]) {
      const r = runPreflight({ ...base, sources: ['google_places'], allowPaid }, deps());
      expect(r.ok).toBe(false);
      const detail = r.checks.find((c) => c.id === 'sources')!.detail;
      expect(detail).toContain('API paga');
      expect(detail).toContain('L5');
      if (allowPaid) expect(detail).toContain('--allow-paid não tem efeito');
    }
  });

  it('--allow-paid sem selecção também é recusado (não pode ser ignorado em silêncio)', () => {
    expect(failed(runPreflight({ ...base, allowPaid: true }, deps()))).toEqual(['sources']);
  });

  it('recusa fonte que não pertence à região', () => {
    const r = runPreflight({ ...base, sources: ['prefeitura_buzios'] }, deps());
    expect(r.checks.find((c) => c.id === 'sources')!.detail).toContain('não pertence à região');
  });

  it('região só com Google Places → sem fontes executáveis', () => {
    expect(failed(runPreflight({ ...base, region: 'araruama' }, deps()))).toEqual(['sources']);
  });

  it('árvore git suja: falha em execução real, aviso em dry-run (onde o env não se aplica)', () => {
    const dirty = deps({ gitStatusPorcelain: () => ' M src/x.ts\n' });
    expect(failed(runPreflight(base, dirty))).toEqual(['git_clean']);
    const dry = runPreflight({ ...base, dryRun: true }, { ...dirty, assertEnvironment: () => { throw new Error('não devia ser chamado'); } });
    expect(dry.ok).toBe(true);
    expect(dry.checks.find((c) => c.id === 'git_clean')!.status).toBe('warn');
    expect(dry.checks.find((c) => c.id === 'env_target')!.status).toBe('skip');
  });

  it('git indisponível → falha em execução real', () => {
    expect(failed(runPreflight(base, deps({ gitStatusPorcelain: () => null })))).toEqual(['git_clean']);
  });

  describe('janela de re-execução', () => {
    const previous = (over: Partial<RunManifest>): RunManifest =>
      ({
        region: 'cabo_frio',
        dry_run: false,
        run_id: 'r-prev',
        finished_at: '2026-11-14T06:00:00.000Z',
        sources: [{ source_key: 'prefeitura_cabo_frio', status: 'ok' }],
        ...over,
      }) as RunManifest;

    it('execução real recente da mesma fonte → recusado sem --force-rerun', () => {
      const r = runPreflight(base, deps({ previousManifests: () => [previous({})] }));
      expect(failed(r)).toEqual(['rerun_window']);
      expect(r.checks.find((c) => c.id === 'rerun_window')!.detail).toContain('r-prev');
    });

    it('--force-rerun transforma em aviso', () => {
      const r = runPreflight({ ...base, forceRerun: true }, deps({ previousManifests: () => [previous({})] }));
      expect(r.ok).toBe(true);
      expect(r.checks.find((c) => c.id === 'rerun_window')!.status).toBe('warn');
    });

    it.each([
      ['fora da janela', { finished_at: '2026-11-13T00:00:00.000Z' }],
      ['dry-run anterior', { dry_run: true }],
      ['fonte anterior falhou', { sources: [{ source_key: 'prefeitura_cabo_frio', status: 'failed' }] as RunManifest['sources'] }],
      ['outra região', { region: 'buzios' }],
    ])('não bloqueia: %s', (_label, over) => {
      expect(runPreflight(base, deps({ previousManifests: () => [previous(over)] })).ok).toBe(true);
    });
  });
});
