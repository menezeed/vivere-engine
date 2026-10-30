import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// supabase-js é SEMPRE mockado: nenhum cliente real, nenhuma rede.
const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

const nodeRequire = createRequire(import.meta.url);
const http = nodeRequire('node:http') as typeof import('node:http');
const https = nodeRequire('node:https') as typeof import('node:https');
const net = nodeRequire('node:net') as typeof import('node:net');
const dns = nodeRequire('node:dns') as typeof import('node:dns');

// ── Valores 100% FALSOS e sentinelas ────────────────────────────────────────
const STAGING_REF = 'jvtcgomwbfojsttepcfc';
const PRODUCTION_REF = 'ccpqngyupukdefaqvzgl';
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`;
const SERVICE_KEY = `sb_secret_${'SERVICESENTINEL0123456789'}_abcdefghij`;
const PUBLISHABLE_KEY = `sb_publishable_${'ANONSENTINEL0123456789'}_abcdefghij`;
const SECRETS = [SERVICE_KEY, PUBLISHABLE_KEY, 'SERVICESENTINEL', 'ANONSENTINEL'];

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
const makeJwt = (payload: Record<string, unknown>) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.SIGSENTINEL0123`;

const ENV_NAMES = ['VIVERE_ENV', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'VIVERE_PRODUCTION_CONFIRM', 'NODE_ENV'] as const;
type Vars = Partial<Record<(typeof ENV_NAMES)[number], string | undefined>>;
const VALID: Vars = { VIVERE_ENV: 'staging', SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_KEY: SERVICE_KEY };
function withValid(overrides: Vars): Vars {
  const merged: Vars = { ...VALID, ...overrides };
  for (const k of Object.keys(overrides) as Array<keyof Vars>) if (overrides[k] === undefined) delete merged[k];
  return merged;
}
function setEnv(vars: Vars): void {
  for (const n of ENV_NAMES) delete process.env[n];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
}

// ── Cliente falso SÓ DE LEITURA: expõe apenas from().select(); qualquer escrita lançaria TypeError ──
function makeFakeDb(count: number | null) {
  const ops: string[] = [];
  const db = {
    from(table: string) {
      return {
        select(cols: string, options?: unknown) {
          ops.push(`select ${table} [${cols}]${options ? ' ' + JSON.stringify(options) : ''}`);
          return Promise.resolve(
            table === 'activities'
              ? { count, data: null, error: null }
              : { data: null, error: { message: 'relation "information_schema.tables" does not exist' } },
          );
        },
      };
    },
  };
  return { db, ops };
}

let spies: Array<ReturnType<typeof vi.spyOn>> = [];
let netSpies: Array<ReturnType<typeof vi.spyOn>> = [];
const fetchSpy = vi.fn();
const realFetch = globalThis.fetch;
let savedEnv: Record<string, string | undefined> = {};
const fmt = (a: unknown): string => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a));

async function runScript(vars: Vars, count: number | null = 0) {
  vi.resetModules();
  setEnv(vars);
  const fake = makeFakeDb(count);
  createClientMock.mockReset();
  createClientMock.mockImplementation(() => fake.db);
  const exitCodes: number[] = [];
  const out: string[] = [];
  spies.push(vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { exitCodes.push(code ?? 0); return undefined as never; }) as never));
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { out.push(args.map(fmt).join(' ')); }));
  }
  await import('../validate-staging-bootstrap');
  await vi.waitFor(() => { expect(exitCodes.length).toBeGreaterThan(0); }, { timeout: 4000 });
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  return { ops: fake.ops, exitCodes, output: out.join('\n') };
}

beforeEach(() => {
  savedEnv = {};
  for (const n of ENV_NAMES) savedEnv[n] = process.env[n];
  fetchSpy.mockClear();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  netSpies = [
    vi.spyOn(http, 'request'), vi.spyOn(http, 'get'), vi.spyOn(https, 'request'), vi.spyOn(https, 'get'),
    vi.spyOn(net.Socket.prototype, 'connect'), vi.spyOn(dns, 'lookup'), vi.spyOn(dns, 'resolve'),
  ];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const s of [...spies, ...netSpies]) s.mockRestore();
  spies = [];
  for (const n of ENV_NAMES) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
});

const notCreated = () => expect(createClientMock).not.toHaveBeenCalled();

// ── 1. Ambiente ausente ou inválido bloqueia a execução ─────────────────────
describe('validate-staging-bootstrap: ambiente ausente ou inválido', () => {
  it.each<[string, Vars, string]>([
    ['VIVERE_ENV ausente', withValid({ VIVERE_ENV: undefined }), 'ENV_MISSING'],
    ['nenhuma variável', {}, 'ENV_MISSING'],
    ['VIVERE_ENV=prod', withValid({ VIVERE_ENV: 'prod' }), 'ENV_INVALID'],
    ['VIVERE_ENV=development', withValid({ VIVERE_ENV: 'development' }), 'ENV_INVALID'],
    ['NODE_ENV não substitui VIVERE_ENV', withValid({ VIVERE_ENV: undefined, NODE_ENV: 'staging' }), 'ENV_MISSING'],
  ])('%s -> bloqueia antes de createClient e de qualquer consulta', async (_label, vars, code) => {
    const { ops, exitCodes, output } = await runScript(vars);
    notCreated();
    expect(ops).toEqual([]);
    expect(exitCodes).toEqual([1]);
    expect(output).toContain(`[envGuard:${code}]`);
    expect(output).not.toContain('A validar:');
  });
});

// ── 2. URL de Production bloqueia antes de createClient() ───────────────────
describe('validate-staging-bootstrap: URL de Production', () => {
  it.each<[string, Vars]>([
    ['staging declarado com URL de produção', withValid({ SUPABASE_URL: PRODUCTION_URL })],
    ['production + URL de produção + confirmação', withValid({ VIVERE_ENV: 'production', SUPABASE_URL: PRODUCTION_URL, VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF })],
    ['production declarado com URL do staging', withValid({ VIVERE_ENV: 'production' })],
    ['URL de produção com caminho', withValid({ SUPABASE_URL: `${PRODUCTION_URL}/rest/v1` })],
  ])('%s -> PRODUCTION_BLOCKED, sem createClient nem consultas', async (_label, vars) => {
    const { ops, exitCodes, output } = await runScript(vars);
    notCreated();
    expect(ops).toEqual([]);
    expect(exitCodes).toEqual([1]);
    expect(output).toContain('[envGuard:PRODUCTION_BLOCKED]');
    expect(output).not.toContain('A validar:');
  });
  it('URL do staging com barra final -> URL_INVALID (formato estrito)', async () => {
    const { output } = await runScript(withValid({ SUPABASE_URL: `${STAGING_URL}/` }));
    notCreated();
    expect(output).toContain('[envGuard:URL_INVALID]');
  });
});

// ── 3. Chave inválida bloqueia antes de createClient() ──────────────────────
describe('validate-staging-bootstrap: chave inválida', () => {
  it.each<[string, string | undefined, string]>([
    ['ausente', undefined, 'KEY_MISSING'],
    ['publishable', PUBLISHABLE_KEY, 'KEY_NOT_SERVICE_ROLE'],
    ['JWT com role anon', makeJwt({ ref: STAGING_REF, role: 'anon' }), 'KEY_NOT_SERVICE_ROLE'],
    ['JWT de produção', makeJwt({ ref: PRODUCTION_REF, role: 'service_role' }), 'PRODUCTION_BLOCKED'],
    ['sb_secret_ curta', 'sb_secret_abc', 'KEY_INVALID_FORMAT'],
  ])('chave %s -> %s, sem createClient nem consultas', async (_label, key, code) => {
    const { ops, exitCodes, output } = await runScript(withValid({ SUPABASE_SERVICE_KEY: key }));
    notCreated();
    expect(ops).toEqual([]);
    expect(exitCodes).toEqual([1]);
    expect(output).toContain(`[envGuard:${code}]`);
  });
});

// ── 4. Staging válido: cliente e leitura preservados ────────────────────────
describe('validate-staging-bootstrap: staging válido', () => {
  it('cria UM cliente com o URL canónico, a chave e as opções de sempre ({ persistSession: false })', async () => {
    await runScript(VALID);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith(STAGING_URL, SERVICE_KEY, { auth: { persistSession: false } });
  });
  it('lê exactamente o que lia: contagem de activities e information_schema.tables, e mais nada', async () => {
    const { ops } = await runScript(VALID);
    expect(ops).toEqual([
      'select activities [*] {"count":"exact","head":true}',
      'select information_schema.tables [table_schema, table_name, table_type]',
    ]);
    expect(ops.every((o) => o.startsWith('select '))).toBe(true); // só leitura
  });
  it('a confirmação manual foi substituída pela validação automática', async () => {
    const { output } = await runScript(VALID);
    expect(output).toContain(`A validar: ${STAGING_URL}`);
    expect(output).toContain(`Ambiente validado pela guarda: staging (${STAGING_REF})`);
    expect(output).not.toContain('CONFIRMA MANUALMENTE');
  });
  it('contagem pequena -> PASS e saída 0; contagem grande -> FAIL e saída 1 (lógica preservada)', async () => {
    const small = await runScript(VALID, 5);
    expect(small.output).toContain('[PASS] Sem indício de dados de produção (contagem pequena) — contagem actual: 5');
    expect(small.exitCodes).toEqual([0]);
    const big = await runScript(VALID, 5000);
    expect(big.output).toContain('[FAIL] Sem indício de dados de produção (contagem pequena) — contagem actual: 5000');
    expect(big.exitCodes).toEqual([1]);
  });
  it('é independente de NODE_ENV', async () => {
    await runScript(withValid({ NODE_ENV: 'production' }));
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });
});

// ── 5. Limitações pré-existentes: documentadas e visíveis, não escondidas ───
describe('validate-staging-bootstrap: limitações pré-existentes documentadas', () => {
  it('LIMITAÇÃO 2: se a consulta de contagem falhar (count ausente), a verificação AINDA PASSA (comportamento pré-existente)', async () => {
    const { output, exitCodes } = await runScript(VALID, null);
    expect(output).toContain('[PASS] Sem indício de dados de produção (contagem pequena) — contagem actual: null');
    expect(exitCodes).toEqual([0]);
  });
  it('LIMITAÇÃO 4: o erro da consulta a information_schema é ignorado (a execução continua e termina em 0)', async () => {
    const { ops, exitCodes } = await runScript(VALID, 0);
    expect(ops).toContain('select information_schema.tables [table_schema, table_name, table_type]');
    expect(exitCodes).toEqual([0]);
  });
  it('o aviso das limitações é impresso em cada execução', async () => {
    const { output } = await runScript(VALID);
    expect(output).toContain('LIMITAÇÕES: só 1 verificação é executada');
    expect(output).toContain('um PASS não prova que correu');
    expect(output).toContain('esqueleto de verificação inicial');
  });
  const src = fs.readFileSync(fileURLToPath(new URL('../validate-staging-bootstrap.ts', import.meta.url)), 'utf8');
  it('o cabeçalho lista as 5 limitações (falha se alguém as apagar sem as resolver)', () => {
    expect(src).toContain('LIMITAÇÕES PRÉ-EXISTENTES');
    for (const marker of ['É um esqueleto', 'EXPECTED_*', 'O erro da contagem é ignorado', 'não distingue staging de', 'information_schema.tables', 'está desactualizada']) {
      expect(src).toContain(marker);
    }
  });
  it('as listas EXPECTED_* continuam declaradas mas NÃO usadas em nenhuma verificação (limitação 1, ainda por resolver)', () => {
    for (const name of ['EXPECTED_PUBLIC_TABLES', 'EXPECTED_PUBLIC_VIEWS', 'EXPECTED_STAGING_TABLES', 'EXPECTED_FUNCTIONS', 'EXPECTED_TRIGGER', 'EXPECTED_ENGINE_COLUMNS_ACTIVITIES', 'EXPECTED_ENGINE_COLUMNS_VENUES']) {
      expect(src.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).toHaveLength(1);
    }
  });
});

// ── 6. Nenhuma rede ─────────────────────────────────────────────────────────
describe('validate-staging-bootstrap: nenhuma rede', () => {
  it('nenhum cenário (bloqueado ou válido) toca em fetch, http(s), socket ou DNS', async () => {
    for (const vars of [VALID, {}, withValid({ SUPABASE_URL: PRODUCTION_URL }), withValid({ SUPABASE_SERVICE_KEY: PUBLISHABLE_KEY })]) {
      await runScript(vars);
      for (const s of spies) s.mockRestore();
      spies = [];
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const s of netSpies) expect(s).not.toHaveBeenCalled();
  });
});

// ── 7. Nenhum segredo em erros ou logs ──────────────────────────────────────
describe('validate-staging-bootstrap: nenhum segredo em erros nem em logs', () => {
  const scenarios: Array<[string, Vars]> = [
    ['staging válido', VALID],
    ['VIVERE_ENV ausente', withValid({ VIVERE_ENV: undefined })],
    ['URL de produção', withValid({ SUPABASE_URL: PRODUCTION_URL })],
    ['produção + confirmação', withValid({ VIVERE_ENV: 'production', SUPABASE_URL: PRODUCTION_URL, VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF })],
    ['publishable no lugar da service key', withValid({ SUPABASE_SERVICE_KEY: PUBLISHABLE_KEY })],
    ['JWT anon', withValid({ SUPABASE_SERVICE_KEY: makeJwt({ ref: STAGING_REF, role: 'anon' }) })],
    ['URL com credenciais', withValid({ SUPABASE_URL: `https://user:URLSENTINELpass@${STAGING_REF}.supabase.co` })],
  ];
  it.each(scenarios)('%s: nem a chave nem sentinelas aparecem na saída', async (_label, vars) => {
    const { output } = await runScript(vars);
    for (const secret of [...SECRETS, 'URLSENTINELpass']) expect(output).not.toContain(secret);
    expect(output).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/);
  });
});

// ── 8. Estrutura do código ──────────────────────────────────────────────────
describe('validate-staging-bootstrap.ts: estrutura', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../validate-staging-bootstrap.ts', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('assertEnvironment() vem antes do único createClient(), e a confirmação manual desapareceu', () => {
    const guardAt = code.indexOf('assertEnvironment(');
    const creates = [...code.matchAll(/\bcreateClient\s*\(/g)];
    expect(guardAt).toBeGreaterThan(-1);
    expect(creates).toHaveLength(1);
    expect(guardAt).toBeLessThan(creates[0]?.index ?? -1);
    expect(code).not.toContain('CONFIRMA MANUALMENTE');
    expect(code).not.toContain("process.env['SUPABASE_URL']");
  });
  it('não escreve: nenhum insert, update, delete, upsert nem rpc', () => {
    expect(code).not.toMatch(/\.(insert|update|delete|upsert|rpc)\s*\(/);
  });
});
