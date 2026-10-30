import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// createClient REAL envolvido num espião: conta chamadas e prova que construir o cliente não toca na rede.
vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return { ...actual, createClient: vi.fn(actual.createClient) };
});

import { createClient } from '@supabase/supabase-js';
import { getSupabaseClient, _resetSupabaseClient } from '../supabase';
import { EnvGuardError } from '../../../lib/envGuard';
import type { EnvGuardErrorCode } from '../../../lib/envGuard';

// Os módulos nativos vêm por require: o namespace ESM não permite vi.spyOn.
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
const KEY_SENTINEL = 'KEYSENTINEL0123456789';
const SB_SECRET = `sb_secret_${KEY_SENTINEL}_abcdefghij`;
const SIG_SENTINEL = 'SIGSENTINEL0123456789abcdef';
const URL_SECRET = 'URLSENTINELpass';
const CLIENT_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
const makeJwt = (payload: Record<string, unknown>) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${SIG_SENTINEL}`;

const GUARD_VARS = ['VIVERE_ENV', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'VIVERE_PRODUCTION_CONFIRM', 'NODE_ENV'] as const;
type Vars = Partial<Record<(typeof GUARD_VARS)[number], string | undefined>>;
const VALID: Vars = { VIVERE_ENV: 'staging', SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_KEY: SB_SECRET };

function setEnv(vars: Vars): void {
  for (const n of GUARD_VARS) delete process.env[n];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
}
function withValid(overrides: Vars): Vars {
  const merged: Vars = { ...VALID, ...overrides };
  for (const k of Object.keys(overrides) as Array<keyof Vars>) if (overrides[k] === undefined) delete merged[k];
  return merged;
}
function errorOf(): EnvGuardError {
  try {
    getSupabaseClient();
  } catch (e) {
    expect(e).toBeInstanceOf(EnvGuardError);
    return e as EnvGuardError;
  }
  throw new Error('esperava-se EnvGuardError, mas getSupabaseClient() não lançou');
}
const codeOf = (): EnvGuardErrorCode => errorOf().code;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 25));

let savedEnv: Record<string, string | undefined> = {};
const fetchSpy = vi.fn();
const realFetch = globalThis.fetch;
let netSpies: Array<ReturnType<typeof vi.spyOn>> = [];
let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  savedEnv = {};
  for (const n of GUARD_VARS) savedEnv[n] = process.env[n];
  setEnv({});
  _resetSupabaseClient();
  vi.mocked(createClient).mockClear();
  fetchSpy.mockClear();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  netSpies = [
    vi.spyOn(http, 'request'), vi.spyOn(http, 'get'), vi.spyOn(https, 'request'), vi.spyOn(https, 'get'),
    vi.spyOn(net.Socket.prototype, 'connect'), vi.spyOn(dns, 'lookup'), vi.spyOn(dns, 'resolve'),
  ];
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const s of [...netSpies, ...consoleSpies]) s.mockRestore();
  for (const n of GUARD_VARS) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
  _resetSupabaseClient();
});

const notCreated = () => expect(createClient).not.toHaveBeenCalled();

// ── 1. Ambiente ausente ou inválido: createClient NÃO é chamado ─────────────
describe('getSupabaseClient: ambiente ausente ou inválido', () => {
  it('sem nenhuma variável (como em CI sem .env) -> ENV_MISSING, sem createClient', () => {
    setEnv({});
    expect(codeOf()).toBe('ENV_MISSING');
    notCreated();
  });
  it('VIVERE_ENV ausente, com URL e chave válidas -> ENV_MISSING, sem createClient', () => {
    setEnv(withValid({ VIVERE_ENV: undefined }));
    expect(codeOf()).toBe('ENV_MISSING');
    notCreated();
  });
  it('NODE_ENV não substitui VIVERE_ENV', () => {
    setEnv(withValid({ VIVERE_ENV: undefined, NODE_ENV: 'staging' }));
    expect(codeOf()).toBe('ENV_MISSING');
    notCreated();
  });
  it.each(['prod', 'STAGING', 'development', ' staging'])('VIVERE_ENV=%j -> ENV_INVALID, sem createClient', (value) => {
    setEnv(withValid({ VIVERE_ENV: value }));
    expect(codeOf()).toBe('ENV_INVALID');
    notCreated();
  });
});

// ── 2. URL de Production (e URL incorreta): createClient NÃO é chamado ──────
describe('getSupabaseClient: URL de Production ou incorreta', () => {
  it('staging declarado com URL de produção -> PRODUCTION_BLOCKED, sem createClient', () => {
    setEnv(withValid({ SUPABASE_URL: PRODUCTION_URL }));
    expect(codeOf()).toBe('PRODUCTION_BLOCKED');
    notCreated();
  });
  it('VIVERE_ENV=production com URL de produção e confirmação -> PRODUCTION_BLOCKED, sem createClient', () => {
    setEnv(withValid({ VIVERE_ENV: 'production', SUPABASE_URL: PRODUCTION_URL, VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF }));
    expect(codeOf()).toBe('PRODUCTION_BLOCKED');
    notCreated();
  });
  it('VIVERE_ENV=production com URL do staging -> PRODUCTION_BLOCKED, sem createClient', () => {
    setEnv(withValid({ VIVERE_ENV: 'production' }));
    expect(codeOf()).toBe('PRODUCTION_BLOCKED');
    notCreated();
  });
  it.each([
    ['barra final', `${PRODUCTION_URL}/`],
    ['caminho', `${PRODUCTION_URL}/rest/v1`],
    ['maiúsculas', `https://${PRODUCTION_REF.toUpperCase()}.supabase.co`],
  ])('URL de produção com %s -> PRODUCTION_BLOCKED, sem createClient', (_label, url) => {
    setEnv(withValid({ SUPABASE_URL: url }));
    expect(codeOf()).toBe('PRODUCTION_BLOCKED');
    notCreated();
  });
  it('URL do staging com barra final -> URL_INVALID (formato estrito), sem createClient', () => {
    setEnv(withValid({ SUPABASE_URL: `${STAGING_URL}/` }));
    expect(codeOf()).toBe('URL_INVALID');
    notCreated();
  });
  it('SUPABASE_URL ausente -> URL_MISSING; ref desconhecido -> URL_REF_MISMATCH; sem createClient', () => {
    setEnv(withValid({ SUPABASE_URL: undefined }));
    expect(codeOf()).toBe('URL_MISSING');
    setEnv(withValid({ SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' }));
    expect(codeOf()).toBe('URL_REF_MISMATCH');
    notCreated();
  });
});

// ── 3. Chave inválida: createClient NÃO é chamado ───────────────────────────
describe('getSupabaseClient: chave inválida', () => {
  it.each<[string, string | undefined, EnvGuardErrorCode]>([
    ['ausente', undefined, 'KEY_MISSING'],
    ['vazia', '', 'KEY_MISSING'],
    ['só espaços', '   ', 'KEY_INVALID_FORMAT'],
    ['sb_secret_ curta', 'sb_secret_abc', 'KEY_INVALID_FORMAT'],
    ['prefixo desconhecido', `sk_live_${KEY_SENTINEL}abcdefghij`, 'KEY_INVALID_FORMAT'],
    ['publishable', `sb_publishable_${KEY_SENTINEL}_abcdefghij`, 'KEY_NOT_SERVICE_ROLE'],
    ['JWT com role anon', makeJwt({ ref: STAGING_REF, role: 'anon' }), 'KEY_NOT_SERVICE_ROLE'],
    ['JWT de outro projecto', makeJwt({ ref: 'aaaaaaaaaaaaaaaaaaaa', role: 'service_role' }), 'KEY_PROJECT_MISMATCH'],
    ['JWT de produção', makeJwt({ ref: PRODUCTION_REF, role: 'service_role' }), 'PRODUCTION_BLOCKED'],
    ['JWT malformado', `${b64url({ alg: 'HS256' })}.${b64url({ ref: STAGING_REF })}`, 'KEY_INVALID_FORMAT'],
  ])('chave %s -> %s, sem createClient', (_label, key, code) => {
    setEnv(withValid({ SUPABASE_SERVICE_KEY: key }));
    expect(codeOf()).toBe(code);
    notCreated();
  });
});

// ── 4. Staging válido: createClient é chamado ───────────────────────────────
describe('getSupabaseClient: staging válido', () => {
  it('chama createClient UMA vez, com o URL exacto do staging, a chave e as opções de sempre', () => {
    setEnv(VALID);
    const client = getSupabaseClient();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(STAGING_URL, SB_SECRET, CLIENT_OPTIONS);
    expect(typeof client.from).toBe('function');
    expect(typeof client.auth).toBe('object');
  });
  it('é independente de NODE_ENV', () => {
    for (const nodeEnv of ['development', 'production', 'test']) {
      _resetSupabaseClient();
      vi.mocked(createClient).mockClear();
      setEnv(withValid({ NODE_ENV: nodeEnv }));
      expect(getSupabaseClient()).toBeDefined();
      expect(createClient).toHaveBeenCalledTimes(1);
    }
  });
  it('aceita um JWT legado service_role do staging', () => {
    setEnv(withValid({ SUPABASE_SERVICE_KEY: makeJwt({ ref: STAGING_REF, role: 'service_role' }) }));
    expect(getSupabaseClient()).toBeDefined();
    expect(createClient).toHaveBeenCalledTimes(1);
  });
  it('a guarda corre ANTES do createClient: com a guarda a falhar, nada é criado, e depois de corrigir o ambiente cria-se', () => {
    setEnv(withValid({ VIVERE_ENV: undefined }));
    expect(codeOf()).toBe('ENV_MISSING');
    notCreated();
    setEnv(VALID);
    expect(getSupabaseClient()).toBeDefined(); // a falha anterior não "envenenou" o singleton
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

// ── 5. Singleton ────────────────────────────────────────────────────────────
describe('getSupabaseClient: singleton', () => {
  it('chamadas subsequentes reutilizam a mesma instância, sem novo createClient', () => {
    setEnv(VALID);
    const first = getSupabaseClient();
    const second = getSupabaseClient();
    const third = getSupabaseClient();
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
  it('comportamento existente preservado: o singleton é devolvido sem revalidar (já está ligado ao URL validado)', () => {
    setEnv(VALID);
    const first = getSupabaseClient();
    setEnv({}); // ambiente passa a inválido depois de o cliente existir
    expect(getSupabaseClient()).toBe(first);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

// ── 6. _resetSupabaseClient ─────────────────────────────────────────────────
describe('_resetSupabaseClient', () => {
  it('permite nova inicialização: o createClient volta a ser chamado e a instância é outra', () => {
    setEnv(VALID);
    const first = getSupabaseClient();
    _resetSupabaseClient();
    const second = getSupabaseClient();
    expect(second).not.toBe(first);
    expect(createClient).toHaveBeenCalledTimes(2);
  });
  it('NÃO contorna a guarda: depois do reset, um ambiente inválido volta a falhar sem createClient', () => {
    setEnv(VALID);
    getSupabaseClient();
    vi.mocked(createClient).mockClear();
    _resetSupabaseClient();
    setEnv(withValid({ SUPABASE_URL: PRODUCTION_URL }));
    expect(codeOf()).toBe('PRODUCTION_BLOCKED');
    notCreated();
  });
  it('sem cliente criado, o reset é inofensivo e repetível', () => {
    expect(() => { _resetSupabaseClient(); _resetSupabaseClient(); }).not.toThrow();
  });
});

// ── 7. Nenhuma chamada real à rede ──────────────────────────────────────────
describe('getSupabaseClient: nenhuma chamada à rede', () => {
  it('nem a validação, nem a criação do cliente real tocam na rede (fetch, http(s), socket, DNS)', async () => {
    const attempts: Vars[] = [
      VALID,
      withValid({ SUPABASE_SERVICE_KEY: makeJwt({ ref: STAGING_REF, role: 'service_role' }) }),
      {},
      withValid({ VIVERE_ENV: undefined }),
      withValid({ SUPABASE_URL: PRODUCTION_URL }),
      withValid({ VIVERE_ENV: 'production', SUPABASE_URL: PRODUCTION_URL, VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF }),
      withValid({ SUPABASE_SERVICE_KEY: `sb_publishable_${KEY_SENTINEL}_abcdefghij` }),
    ];
    for (const vars of attempts) {
      _resetSupabaseClient();
      setEnv(vars);
      try {
        getSupabaseClient();
      } catch (e) {
        expect(e).toBeInstanceOf(EnvGuardError);
      }
    }
    await tick(); // deixa correr qualquer inicialização assíncrona do cliente real
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const s of netSpies) expect(s).not.toHaveBeenCalled();
  });
});

// ── 8. Nenhum segredo em mensagens, erros ou logs ───────────────────────────
describe('getSupabaseClient: nenhum segredo em mensagens de erro nem em logs', () => {
  const jwtProd = makeJwt({ ref: PRODUCTION_REF, role: 'service_role' });
  const jwtAnon = makeJwt({ ref: STAGING_REF, role: 'anon' });
  const jwtOther = makeJwt({ ref: 'aaaaaaaaaaaaaaaaaaaa', role: 'service_role' });
  const secrets = [KEY_SENTINEL, SIG_SENTINEL, URL_SECRET, SB_SECRET, jwtProd, jwtAnon, jwtOther];

  const failing: Array<[string, Vars]> = [
    ['JWT de produção', withValid({ SUPABASE_SERVICE_KEY: jwtProd })],
    ['JWT anon', withValid({ SUPABASE_SERVICE_KEY: jwtAnon })],
    ['JWT de outro projecto', withValid({ SUPABASE_SERVICE_KEY: jwtOther })],
    ['publishable', withValid({ SUPABASE_SERVICE_KEY: `sb_publishable_${KEY_SENTINEL}_abcdefghij` })],
    ['sb_secret_ malformada', withValid({ SUPABASE_SERVICE_KEY: `sb_secret_${KEY_SENTINEL}!!` })],
    ['chave com espaços', withValid({ SUPABASE_SERVICE_KEY: ` ${SB_SECRET} ` })],
    ['URL com credenciais', withValid({ SUPABASE_URL: `https://user:${URL_SECRET}@${STAGING_REF}.supabase.co` })],
    ['URL de produção + chave válida', withValid({ SUPABASE_URL: PRODUCTION_URL })],
    ['produção declarada com confirmação', withValid({ VIVERE_ENV: 'production', VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF })],
    ['ambiente em falta', withValid({ VIVERE_ENV: undefined })],
  ];

  it.each(failing)('falha %s sem expor segredos em message, stack, JSON nem logs', (_label, vars) => {
    setEnv(vars);
    const err = errorOf();
    const blobs = [err.message, String(err), err.stack ?? '', JSON.stringify(err), JSON.stringify({ ...err })];
    for (const blob of blobs) {
      for (const secret of secrets) expect(blob).not.toContain(secret);
      expect(blob).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/);
    }
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    notCreated();
  });

  it('o caminho de sucesso também não regista nada nem devolve a chave em mensagens', async () => {
    setEnv(VALID);
    const client = getSupabaseClient();
    await tick();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    expect(String(client)).not.toContain(KEY_SENTINEL);
  });
});

// ── 9. Estrutura do código: a guarda vem antes do createClient ──────────────
describe('supabase.ts: estrutura', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../supabase.ts', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('assertEnvironment() é chamada antes de createClient(), que aparece uma só vez', () => {
    const guardAt = code.indexOf('assertEnvironment(');
    const createCalls = [...code.matchAll(/\bcreateClient\s*\(/g)];
    expect(guardAt).toBeGreaterThan(-1);
    expect(createCalls).toHaveLength(1);
    expect(guardAt).toBeLessThan(createCalls[0]?.index ?? -1);
  });
  it('só importa o supabase-js e a guarda; não regista, não faz fetch nem lê NODE_ENV', () => {
    const imports = [...code.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@supabase/supabase-js', '../../lib/envGuard.js']);
    expect(code).not.toMatch(/\bconsole\./);
    expect(code).not.toMatch(/\blogger\b/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/NODE_ENV/);
  });
  it('mantém a API pública: getSupabaseClient() sem argumentos e _resetSupabaseClient()', () => {
    expect(typeof getSupabaseClient).toBe('function');
    expect(getSupabaseClient.length).toBe(0);
    expect(typeof _resetSupabaseClient).toBe('function');
  });
});
