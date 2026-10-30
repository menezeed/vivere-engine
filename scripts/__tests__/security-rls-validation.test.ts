import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// supabase-js é SEMPRE mockado: nenhum cliente real, nenhuma rede, nenhuma escrita real.
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
const ANON_KEY = `sb_publishable_${'ANONSENTINEL0123456789'}_abcdefghij`;
const USER_EMAIL = 'user.sentinel@test.invalid';
const USER_PASSWORD = 'USERPASSWORDSENTINEL';
const ADMIN_EMAIL = 'admin.sentinel@test.invalid';
const ADMIN_PASSWORD = 'ADMINPASSWORDSENTINEL';
const SECRETS = [SERVICE_KEY, ANON_KEY, USER_PASSWORD, ADMIN_PASSWORD, 'SERVICESENTINEL', 'ANONSENTINEL'];
const CLIENT_OPTIONS = { auth: { persistSession: false } };

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
const makeJwt = (payload: Record<string, unknown>) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.SIGSENTINEL0123`;

const ENV_NAMES = [
  'VIVERE_ENV', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY', 'VIVERE_PRODUCTION_CONFIRM', 'NODE_ENV',
  'SECURITY_TEST_USER_EMAIL', 'SECURITY_TEST_USER_PASSWORD', 'SECURITY_TEST_ADMIN_EMAIL', 'SECURITY_TEST_ADMIN_PASSWORD',
] as const;
type Vars = Partial<Record<(typeof ENV_NAMES)[number], string | undefined>>;
const VALID: Vars = {
  VIVERE_ENV: 'staging', SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY,
  SECURITY_TEST_USER_EMAIL: USER_EMAIL, SECURITY_TEST_USER_PASSWORD: USER_PASSWORD,
  SECURITY_TEST_ADMIN_EMAIL: ADMIN_EMAIL, SECURITY_TEST_ADMIN_PASSWORD: ADMIN_PASSWORD,
};
function withValid(overrides: Vars): Vars {
  const merged: Vars = { ...VALID, ...overrides };
  for (const k of Object.keys(overrides) as Array<keyof Vars>) if (overrides[k] === undefined) delete merged[k];
  return merged;
}
function setEnv(vars: Vars): void {
  for (const n of ENV_NAMES) delete process.env[n];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
}

// ── Backend falso em memória (RLS simplificada). Regista cada operação por identidade. ──
type Role = 'service' | 'anon' | 'authed' | 'admin';
type Row = Record<string, unknown>;
interface Result { data: unknown; error: { message: string } | null }
type Query = PromiseLike<Result>;
interface FakeClient {
  role: Role; url: string; key: string; options: unknown;
  auth: { signInWithPassword(c: { email: string; password: string }): Promise<{ error: null }>; getUser(): Promise<{ data: { user: { app_metadata: Row } } }> };
  from(table: string): Query;
}
type Backend = ReturnType<typeof makeBackend>;

function makeBackend() {
  const store: Record<string, Row[]> = { activities: [], venues: [], partners: [], categories: [] };
  const ops: string[] = [];
  const authLog: string[] = [];
  const created: FakeClient[] = [];
  let seq = 0;
  const norm = (v: unknown): string => (typeof v === 'string' ? v.replace(/^(activities|venues|partners|categories)-\d+$/, '#$1') : String(v));
  const pick = (row: Row, cols: string): Row => {
    if (cols === '*') return { ...row };
    const out: Row = {};
    for (const c of cols.split(',').map((s) => s.trim())) out[c] = row[c];
    return out;
  };

  class QueryImpl implements PromiseLike<Result> {
    private verb: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload: Row | null = null;
    private cols = '*';
    private filters: Array<[string, string, unknown]> = [];
    private mode: 'many' | 'single' | 'maybe' = 'many';
    constructor(private readonly client: FakeClient, private readonly table: string) {}
    insert(row: Row) { this.verb = 'insert'; this.payload = row; return this; }
    update(patch: Row) { this.verb = 'update'; this.payload = patch; return this; }
    delete() { this.verb = 'delete'; return this; }
    select(cols = '*') { this.cols = cols; return this; }
    eq(col: string, val: unknown) { this.filters.push(['eq', col, val]); return this; }
    ilike(col: string, pattern: string) { this.filters.push(['ilike', col, pattern]); return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
      return Promise.resolve(this.execute()).then(ok, ko);
    }
    private matches(row: Row): boolean {
      return this.filters.every(([kind, col, val]) =>
        kind === 'eq' ? row[col] === val : String(row[col] ?? '').toLowerCase().startsWith(String(val).replace(/%$/, '').toLowerCase()));
    }
    private execute(): Result {
      const role = this.client.role;
      const rows = (store[this.table] ??= []);
      const shape = [
        role, this.verb, this.table,
        this.verb === 'select' || this.verb === 'insert' ? `[${this.cols}]` : '',
        this.payload ? `{${Object.keys(this.payload).sort().join(',')}}` : '',
        this.filters.map(([k, c, v]) => `${k}:${c}=${norm(v)}`).join(' '),
      ].filter(Boolean).join(' ');
      ops.push(shape);

      const asResult = (matching: Row[]): Result => {
        const picked = matching.map((r) => pick(r, this.cols));
        if (this.mode === 'many') return { data: picked, error: null };
        if (picked.length === 0) return this.mode === 'maybe' ? { data: null, error: null } : { data: null, error: { message: 'no rows' } };
        return { data: picked[0], error: null };
      };
      if (this.verb === 'insert') {
        if (role !== 'service') return { data: null, error: { message: 'new row violates row-level security policy' } };
        const row: Row = { id: `${this.table}-${++seq}`, ...(this.payload ?? {}) };
        rows.push(row);
        return asResult([row]);
      }
      if (this.verb === 'select') {
        const visible = role === 'service' || this.table === 'activities' ? rows.filter((r) => this.matches(r)) : [];
        return asResult(visible);
      }
      if (role !== 'service') return { data: null, error: null }; // RLS: UPDATE/DELETE bloqueado não lança erro, não afecta linhas
      if (this.verb === 'update') {
        for (const r of rows.filter((x) => this.matches(x))) Object.assign(r, this.payload);
        return { data: null, error: null };
      }
      store[this.table] = rows.filter((r) => !this.matches(r));
      return { data: null, error: null };
    }
  }

  function makeClient(url: string, key: string, options: unknown): FakeClient {
    const client: FakeClient = {
      role: key === SERVICE_KEY ? 'service' : 'anon', url, key, options,
      auth: {
        signInWithPassword: async (c) => {
          authLog.push(`${client.role} signInWithPassword ${c.email === USER_EMAIL ? 'user' : c.email === ADMIN_EMAIL ? 'admin' : 'desconhecido'}`);
          if (c.email === ADMIN_EMAIL) client.role = 'admin';
          else if (c.email === USER_EMAIL) client.role = 'authed';
          return { error: null };
        },
        getUser: async () => {
          authLog.push(`${client.role} getUser`);
          return { data: { user: { app_metadata: client.role === 'admin' ? { role: 'admin' } : {} } } };
        },
      },
      from: (table: string) => new QueryImpl(client, table),
    };
    created.push(client);
    return client;
  }
  return { store, ops, authLog, created, makeClient };
}

// ── Execução do script por import dinâmico (arranca main() ao importar) ─────
class ExitSignal extends Error {}
let spies: Array<ReturnType<typeof vi.spyOn>> = [];
let netSpies: Array<ReturnType<typeof vi.spyOn>> = [];
const fetchSpy = vi.fn();
const realFetch = globalThis.fetch;
let savedEnv: Record<string, string | undefined> = {};

const fmt = (a: unknown): string => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a));

async function runHarness(vars: Vars, opts: { exitThrows?: boolean } = {}) {
  vi.resetModules();
  setEnv(vars);
  const backend = makeBackend();
  createClientMock.mockReset();
  createClientMock.mockImplementation((url: string, key: string, options: unknown) => backend.makeClient(url, key, options));
  const exitCodes: number[] = [];
  const out: string[] = [];
  spies.push(vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    if (opts.exitThrows && exitCodes.length === 1) throw new ExitSignal(`process.exit(${code ?? 0})`);
    return undefined as never;
  }) as never));
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { out.push(args.map(fmt).join(' ')); }));
  }
  await import('../security-rls-validation');
  await vi.waitFor(() => { expect(exitCodes.length).toBeGreaterThan(0); }, { timeout: 4000 });
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  return { backend, exitCodes, output: out.join('\n') };
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
const noBackendActivity = (b: Backend) => { expect(b.ops).toEqual([]); expect(b.authLog).toEqual([]); expect(b.created).toHaveLength(0); };

// Sequência de operações do harness ORIGINAL (gerada contra o backend falso, antes da alteração).
const GOLDEN_OPS: string[] = [
  'service insert activities [id, interested_count] {engine_status,interested_count,product_key,source_key,title}',
  'service insert venues [id] {engine_status,name,product_key,source_key}',
  'service insert partners [id] {active,name}',
  'service insert categories [id] {emoji,key,label_en,label_pt}',
  'anon select activities [id] eq:id=#activities',
  'authed select activities [id] eq:id=#activities',
  'authed select activities [interested_count] eq:id=#activities',
  'authed update activities {interested_count} eq:id=#activities',
  'authed select activities [interested_count] eq:id=#activities',
  'authed update activities {interested_count} eq:id=#activities',
  'authed select activities [interested_count] eq:id=#activities',
  'authed update activities {interested_count} eq:id=#activities',
  'authed update activities {interested_count} eq:id=#activities',
  'authed update activities {title} eq:id=#activities',
  'authed update activities {product_key} eq:id=#activities',
  'authed update activities {recurrence_type} eq:id=#activities',
  'authed insert activities [id] {engine_status,product_key,source_key,title}',
  'anon insert activities [id] {engine_status,product_key,source_key,title}',
  'authed delete activities eq:id=#activities',
  'authed select activities [id] eq:id=#activities',
  'authed update venues {name} eq:id=#venues',
  'service select venues [name] eq:id=#venues',
  'authed update partners {name} eq:id=#partners',
  'service select partners [name] eq:id=#partners',
  'authed update categories {label_pt} eq:id=#categories',
  'service select categories [label_pt] eq:id=#categories',
  'admin update activities {title} eq:id=#activities',
  'admin update venues {name} eq:id=#venues',
  'service select venues [name] eq:id=#venues',
  'service select activities [id, title, interested_count, product_key, recurrence_type] eq:id=#activities',
  'service delete activities eq:id=#activities',
  'service delete venues eq:id=#venues',
  'service delete partners eq:id=#partners',
  'service delete categories eq:id=#categories',
  'service select activities [id] ilike:title=SECURITY_TEST_DO_NOT_PUBLISH%',
  'service select venues [id] ilike:name=SECURITY_TEST_DO_NOT_PUBLISH%',
  'service select partners [id] ilike:name=SECURITY_TEST_DO_NOT_PUBLISH%',
  'service select categories [id] ilike:label_pt=SECURITY_TEST_DO_NOT_PUBLISH%',
];
const GOLDEN_AUTH: string[] = [
  'anon signInWithPassword user',
  'anon signInWithPassword admin',
  'admin getUser',
];
const GOLDEN_EXIT: number[] = [1];

// ── 1. Ambiente ausente ou inválido bloqueia a execução ─────────────────────
describe('security-rls-validation: ambiente ausente ou inválido', () => {
  it.each<[string, Vars, string]>([
    ['VIVERE_ENV ausente', withValid({ VIVERE_ENV: undefined }), 'ENV_MISSING'],
    ['nenhuma variável', {}, 'ENV_MISSING'],
    ['VIVERE_ENV=prod', withValid({ VIVERE_ENV: 'prod' }), 'ENV_INVALID'],
    ['VIVERE_ENV=STAGING', withValid({ VIVERE_ENV: 'STAGING' }), 'ENV_INVALID'],
    ['NODE_ENV não substitui VIVERE_ENV', withValid({ VIVERE_ENV: undefined, NODE_ENV: 'staging' }), 'ENV_MISSING'],
  ])('%s -> bloqueia antes de createClient, de autenticar e de qualquer operação', async (_label, vars, code) => {
    const { backend, exitCodes, output } = await runHarness(vars);
    notCreated();
    noBackendActivity(backend);
    expect(exitCodes[0]).toBe(1);
    expect(output).toContain(`[envGuard:${code}]`);
    expect(output).toContain('ERRO FATAL');
  });
});

// ── 2. URL de Production bloqueia antes de createClient() ───────────────────
describe('security-rls-validation: URL de Production', () => {
  it.each<[string, Vars]>([
    ['staging declarado com URL de produção', withValid({ SUPABASE_URL: PRODUCTION_URL })],
    ['production + URL de produção + confirmação', withValid({ VIVERE_ENV: 'production', SUPABASE_URL: PRODUCTION_URL, VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF })],
    ['production declarado com URL do staging', withValid({ VIVERE_ENV: 'production' })],
    ['URL de produção com barra final', withValid({ SUPABASE_URL: `${PRODUCTION_URL}/` })],
  ])('%s -> PRODUCTION_BLOCKED, sem createClient nem operações', async (_label, vars) => {
    const { backend, exitCodes, output } = await runHarness(vars);
    notCreated();
    noBackendActivity(backend);
    expect(exitCodes[0]).toBe(1);
    expect(output).toContain('[envGuard:PRODUCTION_BLOCKED]');
  });
  it('URL do staging com barra final -> URL_INVALID (formato estrito), sem createClient', async () => {
    const { backend, output } = await runHarness(withValid({ SUPABASE_URL: `${STAGING_URL}/` }));
    notCreated();
    noBackendActivity(backend);
    expect(output).toContain('[envGuard:URL_INVALID]');
  });
});

// ── 3. Chave inválida bloqueia antes de createClient() ──────────────────────
describe('security-rls-validation: chave de servidor inválida', () => {
  it.each<[string, string | undefined, string]>([
    ['ausente', undefined, 'KEY_MISSING'],
    ['publishable no lugar da service key', ANON_KEY, 'KEY_NOT_SERVICE_ROLE'],
    ['JWT com role anon', makeJwt({ ref: STAGING_REF, role: 'anon' }), 'KEY_NOT_SERVICE_ROLE'],
    ['JWT de produção', makeJwt({ ref: PRODUCTION_REF, role: 'service_role' }), 'PRODUCTION_BLOCKED'],
    ['sb_secret_ curta', 'sb_secret_abc', 'KEY_INVALID_FORMAT'],
  ])('service key %s -> %s, sem createClient nem operações', async (_label, key, code) => {
    const { backend, exitCodes, output } = await runHarness(withValid({ SUPABASE_SERVICE_KEY: key }));
    notCreated();
    noBackendActivity(backend);
    expect(exitCodes[0]).toBe(1);
    expect(output).toContain(`[envGuard:${code}]`);
  });
});

// ── 4. Credenciais do harness validadas antes de criar clientes ─────────────
describe('security-rls-validation: credenciais necessárias antes de criar clientes', () => {
  it('anon key igual à service key -> STOP, sem createClient', async () => {
    const { backend, exitCodes, output } = await runHarness(withValid({ SUPABASE_ANON_KEY: SERVICE_KEY }), { exitThrows: true });
    notCreated();
    noBackendActivity(backend);
    expect(exitCodes[0]).toBe(1);
    expect(output).toContain('STOP: SUPABASE_ANON_KEY não pode ser uma chave de servidor');
  });
  it('anon key sb_secret_ -> STOP, sem createClient', async () => {
    const { backend, exitCodes, output } = await runHarness(withValid({ SUPABASE_ANON_KEY: `sb_secret_${'OTHERSENTINEL0123456789'}_abcdefghij` }), { exitThrows: true });
    notCreated();
    noBackendActivity(backend);
    expect(exitCodes[0]).toBe(1);
    expect(output).toContain('STOP: SUPABASE_ANON_KEY não pode ser uma chave de servidor');
  });
  it('SUPABASE_ANON_KEY em falta -> STOP (mensagem original), sem createClient', async () => {
    const { backend, exitCodes, output } = await runHarness(withValid({ SUPABASE_ANON_KEY: undefined }), { exitThrows: true });
    notCreated();
    noBackendActivity(backend);
    expect(exitCodes[0]).toBe(1);
    expect(output).toContain('STOP: variável de ambiente SUPABASE_ANON_KEY em falta.');
  });
  it.each<[string, Vars, string]>([
    ['conta de teste sem email', withValid({ SECURITY_TEST_USER_EMAIL: undefined }), 'STOP: SECURITY_TEST_USER_EMAIL / SECURITY_TEST_USER_PASSWORD em falta.'],
    ['conta de teste sem password', withValid({ SECURITY_TEST_USER_PASSWORD: undefined }), 'STOP: SECURITY_TEST_USER_EMAIL / SECURITY_TEST_USER_PASSWORD em falta.'],
    ['conta admin sem email', withValid({ SECURITY_TEST_ADMIN_EMAIL: undefined }), 'STOP: SECURITY_TEST_ADMIN_EMAIL / SECURITY_TEST_ADMIN_PASSWORD em falta.'],
    ['conta admin sem password', withValid({ SECURITY_TEST_ADMIN_PASSWORD: undefined }), 'STOP: SECURITY_TEST_ADMIN_EMAIL / SECURITY_TEST_ADMIN_PASSWORD em falta.'],
  ])('%s -> STOP (mensagem original), e já nenhum cliente foi criado', async (_label, vars, message) => {
    const { backend, exitCodes, output } = await runHarness(vars, { exitThrows: true });
    notCreated();
    noBackendActivity(backend);
    expect(exitCodes[0]).toBe(1);
    expect(output).toContain(message);
  });
});

// ── 5. Staging válido: os 4 clientes esperados, com as identidades e opções de sempre ──
describe('security-rls-validation: staging válido', () => {
  it('cria os 4 clientes pela ordem de sempre, com o URL canónico e as opções de sempre', async () => {
    const { backend } = await runHarness(VALID);
    expect(createClientMock).toHaveBeenCalledTimes(4);
    expect(createClientMock.mock.calls).toEqual([
      [STAGING_URL, SERVICE_KEY, CLIENT_OPTIONS], // serviceClient
      [STAGING_URL, ANON_KEY, CLIENT_OPTIONS],    // anonClient
      [STAGING_URL, ANON_KEY, CLIENT_OPTIONS],    // authedClient
      [STAGING_URL, ANON_KEY, CLIENT_OPTIONS],    // adminClient
    ]);
    expect(backend.created.map((c) => c.role)).toEqual(['service', 'anon', 'authed', 'admin']); // identidades distintas
  });
  it('autentica as duas contas de teste e confirma o role admin, como antes', async () => {
    const { backend, output } = await runHarness(VALID);
    expect(backend.authLog).toEqual(GOLDEN_AUTH);
    expect(output).toContain('Clientes autenticados com sucesso (anon, authenticated de teste, admin confirmado).');
  });
  it('é independente de NODE_ENV', async () => {
    const { backend } = await runHarness(withValid({ NODE_ENV: 'production' }));
    expect(backend.created).toHaveLength(4);
  });
});

// ── 6. Fluxos, fixtures e cleanup preservados ───────────────────────────────
describe('security-rls-validation: comportamento preservado', () => {
  it('a sequência de operações (fixtures, testes, cleanup, varredura final) é IDÊNTICA à do harness original', async () => {
    const { backend } = await runHarness(VALID);
    expect(backend.ops).toEqual(GOLDEN_OPS);
  });
  it('as 4 fixtures são criadas pela service key e TODAS removidas no fim (fail-closed): nada resta no backend', async () => {
    const { backend, output } = await runHarness(VALID);
    const inserts = backend.ops.filter((o) => o.startsWith('service insert'));
    const deletes = backend.ops.filter((o) => o.startsWith('service delete'));
    expect(inserts.map((o) => o.split(' ')[2])).toEqual(['activities', 'venues', 'partners', 'categories']);
    expect(deletes).toHaveLength(4);
    expect(Object.values(backend.store).flat()).toHaveLength(0);
    expect(output).toContain('SECURITY_TEST fixtures remaining (varredura final): 0');
  });
  it('só a service key escreve fixtures; nenhuma escrita de anon/authed/admin persiste', async () => {
    const { backend } = await runHarness(VALID);
    const writes = backend.ops.filter((o) => /^(anon|authed|admin) (insert|update|delete)/.test(o));
    expect(writes.length).toBeGreaterThan(0); // as tentativas existem...
    expect(Object.values(backend.store).flat()).toHaveLength(0); // ...mas o backend fica limpo
  });
  it('imprime os resultados e sai com o mesmo código de saída que o original', async () => {
    const { exitCodes, output } = await runHarness(VALID);
    expect(output).toContain('=== RESULTADOS ===');
    expect(exitCodes).toEqual(GOLDEN_EXIT);
  });
});

// ── 7. Nenhuma rede nem escrita real ────────────────────────────────────────
describe('security-rls-validation: nenhuma rede nem escrita real', () => {
  it('nenhum cenário (bloqueado ou válido) toca em fetch, http(s), socket ou DNS', async () => {
    for (const vars of [VALID, {}, withValid({ SUPABASE_URL: PRODUCTION_URL }), withValid({ SUPABASE_SERVICE_KEY: ANON_KEY })]) {
      await runHarness(vars);
      for (const s of spies) s.mockRestore();
      spies = [];
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const s of netSpies) expect(s).not.toHaveBeenCalled();
  });
});

// ── 8. Nenhum segredo em erros ou logs ──────────────────────────────────────
describe('security-rls-validation: nenhum segredo em erros nem em logs', () => {
  const scenarios: Array<[string, Vars, boolean]> = [
    ['staging válido', VALID, false],
    ['VIVERE_ENV ausente', withValid({ VIVERE_ENV: undefined }), false],
    ['URL de produção', withValid({ SUPABASE_URL: PRODUCTION_URL }), false],
    ['produção + confirmação', withValid({ VIVERE_ENV: 'production', SUPABASE_URL: PRODUCTION_URL, VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF }), false],
    ['publishable no lugar da service key', withValid({ SUPABASE_SERVICE_KEY: ANON_KEY }), false],
    ['JWT anon no lugar da service key', withValid({ SUPABASE_SERVICE_KEY: makeJwt({ ref: STAGING_REF, role: 'anon' }) }), false],
    ['anon key igual à service key', withValid({ SUPABASE_ANON_KEY: SERVICE_KEY }), true],
    ['credenciais de teste em falta', withValid({ SECURITY_TEST_ADMIN_PASSWORD: undefined }), true],
  ];
  it.each(scenarios)('%s: nem a chave, nem as passwords, nem sentinelas aparecem na saída', async (_label, vars, exitThrows) => {
    const { output } = await runHarness(vars, { exitThrows });
    for (const secret of SECRETS) expect(output).not.toContain(secret);
    expect(output).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/);
  });
});

// ── 9. Estrutura do código ──────────────────────────────────────────────────
describe('security-rls-validation.ts: estrutura', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../security-rls-validation.ts', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('assertEnvironment() vem antes do primeiro createClient(); os 4 createClient e as suas opções ficam', () => {
    const guardAt = code.indexOf('assertEnvironment(');
    const creates = [...code.matchAll(/\bcreateClient\s*\(/g)];
    expect(guardAt).toBeGreaterThan(-1);
    expect(creates).toHaveLength(4);
    expect(guardAt).toBeLessThan(creates[0]?.index ?? -1);
    expect((code.match(/\{ auth: \{ persistSession: false \} \}/g) ?? []).length).toBe(4);
  });
  it('as credenciais do harness são validadas antes do primeiro createClient()', () => {
    const firstCreate = code.search(/\bcreateClient\s*\(/);
    for (const needle of ["requireEnv('SUPABASE_ANON_KEY')", "requireEnv('SUPABASE_SERVICE_KEY')", "'SECURITY_TEST_USER_EMAIL'", "'SECURITY_TEST_ADMIN_PASSWORD'"]) {
      const at = code.indexOf(needle);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(firstCreate);
    }
  });
  it('o URL já não vem de requireEnv: é o canónico da guarda; e o cabeçalho documenta VIVERE_ENV', () => {
    expect(code).not.toContain("requireEnv('SUPABASE_URL')");
    expect(code).toMatch(/const \{ supabaseUrl: url \} = assertEnvironment\(\)/);
    expect(src).toContain('VIVERE_ENV=staging');
  });
});
