import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  assertEnvironment,
  classifyServiceKey,
  EnvGuardError,
  SB_SECRET_UNVERIFIED_WARNING,
  LEGACY_JWT_UNSIGNED_WARNING,
} from '../envGuard';
import type { EnvGuardErrorCode } from '../envGuard';
import { SUPABASE_PROJECT_REFS, supabaseUrlFor } from '../../config/environments';

// Os módulos nativos são obtidos por require: o namespace ESM não permite vi.spyOn (propriedades não configuráveis).
const nodeRequire = createRequire(import.meta.url);
const http = nodeRequire('node:http') as typeof import('node:http');
const https = nodeRequire('node:https') as typeof import('node:https');
const net = nodeRequire('node:net') as typeof import('node:net');
const dns = nodeRequire('node:dns') as typeof import('node:dns');

// --env-file existe desde o Node 20.6 (e 18.17). process.allowedNodeEnvironmentFlags NÃO serve: só lista as flags de NODE_OPTIONS.
function nodeHasEnvFile(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  return major > 20 || (major === 20 && minor >= 6) || (major === 18 && minor >= 17);
}

// ── Valores 100% FALSOS e sentinelas para provar que nada vaza ──────────────
const STAGING_REF = 'jvtcgomwbfojsttepcfc';
const PRODUCTION_REF = 'ccpqngyupukdefaqvzgl';
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`;
const KEY_SENTINEL = 'KEYSENTINEL0123456789';
const SB_SECRET = `sb_secret_${KEY_SENTINEL}_abcdefghij`;
const SIG_SENTINEL = 'SIGSENTINEL0123456789abcdef';

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function makeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${SIG_SENTINEL}`;
}

type Env = NodeJS.ProcessEnv;
function validEnv(overrides: Record<string, string | undefined> = {}): Env {
  const base: Env = { VIVERE_ENV: 'staging', SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_KEY: SB_SECRET };
  const merged: Env = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  return merged;
}

function codeOf(env: Env): EnvGuardErrorCode {
  try {
    assertEnvironment(env);
  } catch (e) {
    if (e instanceof EnvGuardError) return e.code;
    throw e;
  }
  throw new Error('esperava-se EnvGuardError, mas a guarda não lançou');
}
function errorOf(env: Env): EnvGuardError {
  try {
    assertEnvironment(env);
  } catch (e) {
    if (e instanceof EnvGuardError) return e;
    throw e;
  }
  throw new Error('esperava-se EnvGuardError, mas a guarda não lançou');
}

// ── 1. Ambiente ausente ou inválido ─────────────────────────────────────────
describe('envGuard: ambiente ausente ou inválido', () => {
  it('VIVERE_ENV ausente -> ENV_MISSING', () => {
    expect(codeOf(validEnv({ VIVERE_ENV: undefined }))).toBe('ENV_MISSING');
  });
  it('VIVERE_ENV vazio -> ENV_MISSING', () => {
    expect(codeOf(validEnv({ VIVERE_ENV: '' }))).toBe('ENV_MISSING');
  });
  it.each(['prod', 'STAGING', 'Staging', ' staging', 'staging ', 'development', 'test', 'dev', 'local', 'stage', '1'])(
    'VIVERE_ENV=%j -> ENV_INVALID',
    (value) => {
      expect(codeOf(validEnv({ VIVERE_ENV: value }))).toBe('ENV_INVALID');
    },
  );
  it('o objecto de ambiente vazio -> ENV_MISSING (nada é assumido por omissão)', () => {
    expect(codeOf({})).toBe('ENV_MISSING');
  });
  it('NODE_ENV não substitui VIVERE_ENV', () => {
    expect(codeOf(validEnv({ VIVERE_ENV: undefined, NODE_ENV: 'staging' }))).toBe('ENV_MISSING');
    expect(codeOf(validEnv({ VIVERE_ENV: undefined, NODE_ENV: 'development' }))).toBe('ENV_MISSING');
  });
});

// ── 2. URL incorreta ou de Production ───────────────────────────────────────
describe('envGuard: URL incorreta ou de Production', () => {
  it('SUPABASE_URL ausente ou vazio -> URL_MISSING', () => {
    expect(codeOf(validEnv({ SUPABASE_URL: undefined }))).toBe('URL_MISSING');
    expect(codeOf(validEnv({ SUPABASE_URL: '' }))).toBe('URL_MISSING');
  });

  it.each([
    ['http em vez de https', `http://${STAGING_REF}.supabase.co`],
    ['barra final', `${STAGING_URL}/`],
    ['caminho', `${STAGING_URL}/rest/v1`],
    ['porta', `${STAGING_URL}:443`],
    ['maiúsculas no host', `https://${STAGING_REF.toUpperCase()}.supabase.co`],
    ['espaço à volta', ` ${STAGING_URL} `],
    ['quebra de linha final', `${STAGING_URL}\n`],
    ['credenciais no URL', `https://user:URLSENTINELpass@${STAGING_REF}.supabase.co`],
    ['host que não é Supabase', `https://${STAGING_REF}.example.com`],
    ['sufixo malicioso', `${STAGING_URL}.evil.com`],
    ['subdomínio extra', `https://api.${STAGING_REF}.supabase.co`],
    ['sem esquema', `${STAGING_REF}.supabase.co`],
    ['localhost', 'http://localhost:54321'],
    ['ref curto', 'https://abc.supabase.co'],
    ['lixo', 'não é um url'],
  ])('URL com %s -> URL_INVALID', (_label, url) => {
    expect(codeOf(validEnv({ SUPABASE_URL: url }))).toBe('URL_INVALID');
  });

  it('ref de 20 caracteres que não é o do staging -> URL_REF_MISMATCH', () => {
    expect(codeOf(validEnv({ SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' }))).toBe('URL_REF_MISMATCH');
  });

  it('URL de Production com VIVERE_ENV=staging -> PRODUCTION_BLOCKED', () => {
    expect(codeOf(validEnv({ SUPABASE_URL: PRODUCTION_URL }))).toBe('PRODUCTION_BLOCKED');
  });

  it.each([
    ['barra final', `${PRODUCTION_URL}/`],
    ['caminho', `${PRODUCTION_URL}/rest/v1`],
    ['maiúsculas', `https://${PRODUCTION_REF.toUpperCase()}.supabase.co`],
    ['com espaços', ` ${PRODUCTION_URL} `],
    ['com credenciais', `https://user:pw@${PRODUCTION_REF}.supabase.co`],
    ['ref de produção noutro sítio do URL', `${STAGING_URL}/?ref=${PRODUCTION_REF}`],
  ])('qualquer referência à produção no URL (%s) -> PRODUCTION_BLOCKED', (_label, url) => {
    expect(codeOf(validEnv({ SUPABASE_URL: url }))).toBe('PRODUCTION_BLOCKED');
  });
});

// ── 3. Production bloqueada ─────────────────────────────────────────────────
describe('envGuard: Production bloqueada', () => {
  it('VIVERE_ENV=production com URL de produção -> PRODUCTION_BLOCKED', () => {
    expect(codeOf(validEnv({ VIVERE_ENV: 'production', SUPABASE_URL: PRODUCTION_URL }))).toBe('PRODUCTION_BLOCKED');
  });
  it('mesmo com a variável de confirmação igual ao ref de produção', () => {
    expect(
      codeOf(validEnv({ VIVERE_ENV: 'production', SUPABASE_URL: PRODUCTION_URL, VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF })),
    ).toBe('PRODUCTION_BLOCKED');
  });
  it('mesmo com confirmação arbitrária, e com o URL do staging', () => {
    expect(codeOf(validEnv({ VIVERE_ENV: 'production', VIVERE_PRODUCTION_CONFIRM: 'sim' }))).toBe('PRODUCTION_BLOCKED');
  });
  it.each(['production', 'PRODUCTION', 'Production', ' production ', 'production\n'])(
    'VIVERE_ENV=%j (qualquer grafia) -> PRODUCTION_BLOCKED',
    (value) => {
      expect(codeOf(validEnv({ VIVERE_ENV: value }))).toBe('PRODUCTION_BLOCKED');
    },
  );
  it('NODE_ENV não desbloqueia a produção, seja qual for', () => {
    for (const nodeEnv of ['development', 'production', 'test', 'staging', undefined]) {
      expect(codeOf(validEnv({ VIVERE_ENV: 'production', SUPABASE_URL: PRODUCTION_URL, NODE_ENV: nodeEnv }))).toBe(
        'PRODUCTION_BLOCKED',
      );
    }
  });
  it('a mensagem diz que a confirmação não desbloqueia a produção', () => {
    const err = errorOf(validEnv({ VIVERE_ENV: 'production', VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF }));
    expect(err.message).toContain('VIVERE_PRODUCTION_CONFIRM');
    expect(err.message).toContain('não desbloqueia');
  });
  it('a configuração expõe só os refs públicos e o URL canónico; a política "só staging" vive apenas na guarda', () => {
    expect(SUPABASE_PROJECT_REFS.staging).toBe(STAGING_REF);
    expect(SUPABASE_PROJECT_REFS.production).toBe(PRODUCTION_REF);
    expect(supabaseUrlFor('staging')).toBe(STAGING_URL);
    expect(supabaseUrlFor('production')).toBe(PRODUCTION_URL);
    expect(Object.keys(SUPABASE_PROJECT_REFS).sort()).toEqual(['production', 'staging']);
  });
});

// ── 4. Staging válido ───────────────────────────────────────────────────────
describe('envGuard: staging válido', () => {
  it('aceita VIVERE_ENV=staging, URL exacto e sb_secret_', () => {
    const r = assertEnvironment(validEnv());
    expect(r.environment).toBe('staging');
    expect(r.projectRef).toBe(STAGING_REF);
    expect(r.supabaseUrl).toBe(STAGING_URL);
    expect(r.serviceKeyFormat).toBe('sb_secret');
  });
  it('sb_secret_ fica explicitamente NÃO verificado e avisa que o formato não prova o projecto', () => {
    const r = assertEnvironment(validEnv());
    expect(r.serviceKeyProjectBinding).toBe('unverified');
    expect(r.warnings).toContain(SB_SECRET_UNVERIFIED_WARNING);
    expect(SB_SECRET_UNVERIFIED_WARNING).toContain('NÃO comprova');
  });
  it('é independente de NODE_ENV', () => {
    for (const nodeEnv of ['development', 'production', 'test', undefined]) {
      expect(assertEnvironment(validEnv({ NODE_ENV: nodeEnv })).environment).toBe('staging');
    }
  });
  it('aceita um JWT legado service_role com ref do staging, assinalando que a assinatura não foi verificada', () => {
    const jwt = makeJwt({ iss: 'supabase', ref: STAGING_REF, role: 'service_role' });
    const r = assertEnvironment(validEnv({ SUPABASE_SERVICE_KEY: jwt }));
    expect(r.serviceKeyFormat).toBe('legacy_jwt');
    expect(r.serviceKeyProjectBinding).toBe('jwt_claim_unsigned');
    expect(r.warnings).toContain(LEGACY_JWT_UNSIGNED_WARNING);
  });
  it('o resultado não contém a chave', () => {
    const r = assertEnvironment(validEnv());
    expect(JSON.stringify(r)).not.toContain(KEY_SENTINEL);
  });
  it('lê process.env no momento da chamada quando não recebe argumento', () => {
    const saved = { ...process.env };
    try {
      for (const k of ['VIVERE_ENV', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'VIVERE_PRODUCTION_CONFIRM']) delete process.env[k];
      expect(() => assertEnvironment()).toThrowError(/ENV_MISSING/);
      process.env['VIVERE_ENV'] = 'staging';
      process.env['SUPABASE_URL'] = STAGING_URL;
      process.env['SUPABASE_SERVICE_KEY'] = SB_SECRET;
      expect(assertEnvironment().environment).toBe('staging');
      process.env['SUPABASE_URL'] = PRODUCTION_URL;
      expect(() => assertEnvironment()).toThrowError(/PRODUCTION_BLOCKED/);
    } finally {
      for (const k of ['VIVERE_ENV', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'VIVERE_PRODUCTION_CONFIRM']) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

// ── 5. Chave inválida ───────────────────────────────────────────────────────
describe('envGuard: chave inválida', () => {
  const keyEnv = (key: string | undefined) => validEnv({ SUPABASE_SERVICE_KEY: key });

  it('ausente ou vazia -> KEY_MISSING', () => {
    expect(codeOf(keyEnv(undefined))).toBe('KEY_MISSING');
    expect(codeOf(keyEnv(''))).toBe('KEY_MISSING');
  });
  it.each([
    ['só espaços', '   '],
    ['espaço à volta', ` ${SB_SECRET} `],
    ['quebra de linha final', `${SB_SECRET}\n`],
    ['espaço no meio', 'sb_secret_AAAAAAAAAAAA AAAAAAAAAAAA'],
  ])('chave com %s -> KEY_INVALID_FORMAT', (_label, key) => {
    expect(codeOf(keyEnv(key))).toBe('KEY_INVALID_FORMAT');
  });
  it('chave publishable -> KEY_NOT_SERVICE_ROLE', () => {
    expect(codeOf(keyEnv(`sb_publishable_${KEY_SENTINEL}_abcdefghij`))).toBe('KEY_NOT_SERVICE_ROLE');
  });
  it.each(['anon', 'authenticated', 'postgres', 'qualquer-coisa'])('JWT com role %j -> KEY_NOT_SERVICE_ROLE', (role) => {
    expect(codeOf(keyEnv(makeJwt({ ref: STAGING_REF, role })))).toBe('KEY_NOT_SERVICE_ROLE');
  });
  it('JWT sem role -> KEY_INVALID_FORMAT', () => {
    expect(codeOf(keyEnv(makeJwt({ ref: STAGING_REF })))).toBe('KEY_INVALID_FORMAT');
  });
  it('JWT sem ref (ou ref vazio / não texto) -> KEY_INVALID_FORMAT', () => {
    expect(codeOf(keyEnv(makeJwt({ role: 'service_role' })))).toBe('KEY_INVALID_FORMAT');
    expect(codeOf(keyEnv(makeJwt({ role: 'service_role', ref: '' })))).toBe('KEY_INVALID_FORMAT');
    expect(codeOf(keyEnv(makeJwt({ role: 'service_role', ref: 123 })))).toBe('KEY_INVALID_FORMAT');
  });
  it('JWT com ref de produção -> PRODUCTION_BLOCKED, mesmo com role service_role', () => {
    expect(codeOf(keyEnv(makeJwt({ ref: PRODUCTION_REF, role: 'service_role' })))).toBe('PRODUCTION_BLOCKED');
  });
  it('JWT de produção com role anon também -> PRODUCTION_BLOCKED (produção domina)', () => {
    expect(codeOf(keyEnv(makeJwt({ ref: PRODUCTION_REF, role: 'anon' })))).toBe('PRODUCTION_BLOCKED');
  });
  it('JWT com ref de outro projecto -> KEY_PROJECT_MISMATCH', () => {
    expect(codeOf(keyEnv(makeJwt({ ref: 'aaaaaaaaaaaaaaaaaaaa', role: 'service_role' })))).toBe('KEY_PROJECT_MISMATCH');
  });
  it.each([
    ['2 segmentos', `${b64url({ alg: 'HS256' })}.${b64url({ ref: STAGING_REF })}`],
    ['4 segmentos', `${b64url({ a: 1 })}.${b64url({ b: 2 })}.sig.extra`],
    ['segmento vazio', `eyJhbGciOiJIUzI1NiJ9..${SIG_SENTINEL}`],
    ['caracteres inválidos', `eyJhbGciOiJIUzI1NiJ9.@@@@.${SIG_SENTINEL}`],
    ['payload que não é JSON', `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('não json').toString('base64url')}.${SIG_SENTINEL}`],
    ['payload que é um array', `eyJhbGciOiJIUzI1NiJ9.${b64url([1, 2])}.${SIG_SENTINEL}`],
    ['payload null', `eyJhbGciOiJIUzI1NiJ9.${b64url(null)}.${SIG_SENTINEL}`],
  ])('JWT malformado (%s) -> KEY_INVALID_FORMAT', (_label, key) => {
    expect(codeOf(keyEnv(key))).toBe('KEY_INVALID_FORMAT');
  });
  it.each([
    ['sb_secret_ curto', 'sb_secret_abc'],
    ['sb_secret_ com caracteres inválidos', 'sb_secret_!!!!!!!!!!!!!!!!!!!!'],
    ['prefixo desconhecido', `sk_live_${KEY_SENTINEL}abcdefghij`],
    ['texto qualquer', 'isto-nao-e-uma-chave'],
    ['service_role em texto', 'service_role'],
  ])('%s -> KEY_INVALID_FORMAT', (_label, key) => {
    expect(codeOf(keyEnv(key))).toBe('KEY_INVALID_FORMAT');
  });
  it('classifyServiceKey aceita sb_secret_ sem provar o projecto', () => {
    const c = classifyServiceKey(SB_SECRET);
    expect(c.format).toBe('sb_secret');
    expect(c.projectBinding).toBe('unverified');
  });
});

// ── 6. Variáveis conflitantes ───────────────────────────────────────────────
describe('envGuard: variáveis conflitantes', () => {
  it('VIVERE_ENV=staging com URL de produção -> PRODUCTION_BLOCKED', () => {
    expect(codeOf(validEnv({ SUPABASE_URL: PRODUCTION_URL }))).toBe('PRODUCTION_BLOCKED');
  });
  it('VIVERE_ENV=production com URL do staging -> PRODUCTION_BLOCKED', () => {
    expect(codeOf(validEnv({ VIVERE_ENV: 'production' }))).toBe('PRODUCTION_BLOCKED');
  });
  it('VIVERE_PRODUCTION_CONFIRM definida com VIVERE_ENV=staging -> CONFLICTING_VARIABLES', () => {
    expect(codeOf(validEnv({ VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF }))).toBe('CONFLICTING_VARIABLES');
    expect(codeOf(validEnv({ VIVERE_PRODUCTION_CONFIRM: 'qualquer-coisa' }))).toBe('CONFLICTING_VARIABLES');
  });
  it('VIVERE_PRODUCTION_CONFIRM vazia (linha em branco no ficheiro) não é conflito', () => {
    expect(assertEnvironment(validEnv({ VIVERE_PRODUCTION_CONFIRM: '' })).environment).toBe('staging');
  });
  it('NODE_ENV=production com staging válido NÃO é conflito (NODE_ENV é ignorado)', () => {
    expect(assertEnvironment(validEnv({ NODE_ENV: 'production' })).environment).toBe('staging');
  });
  it('staging declarado + URL do staging + chave JWT de produção -> PRODUCTION_BLOCKED', () => {
    expect(codeOf(validEnv({ SUPABASE_SERVICE_KEY: makeJwt({ ref: PRODUCTION_REF, role: 'service_role' }) }))).toBe(
      'PRODUCTION_BLOCKED',
    );
  });

  // Precedência real do Node: variável do processo vence o --env-file. A guarda avalia o ambiente
  // EFECTIVO, por isso um SUPABASE_URL de produção no processo (ex: variável do Windows) é apanhado
  // mesmo que o ficheiro diga staging. Valores 100% falsos; o processo filho não herda o ambiente.
  const nodeSupportsEnvFile = nodeHasEnvFile();
  describe.skipIf(!nodeSupportsEnvFile)('precedência processo vs --env-file (processo filho, sem rede)', () => {
    function effectiveEnv(fileLines: string[], processEnv: Record<string, string>): Env {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envguard-'));
      const file = path.join(dir, '.env.fake');
      fs.writeFileSync(file, fileLines.join('\n'), 'utf8');
      const childEnv: Record<string, string> = { ...processEnv };
      const systemRoot = process.env['SystemRoot'];
      if (systemRoot) childEnv['SystemRoot'] = systemRoot;
      const out = spawnSync(
        process.execPath,
        [
          `--env-file=${file}`,
          '-e',
          "const k=['VIVERE_ENV','SUPABASE_URL','SUPABASE_SERVICE_KEY','VIVERE_PRODUCTION_CONFIRM'];" +
            'const o={};for(const n of k){if(process.env[n]!==undefined)o[n]=process.env[n];}' +
            'process.stdout.write(JSON.stringify(o));',
        ],
        { env: childEnv, encoding: 'utf8' },
      );
      fs.rmSync(dir, { recursive: true, force: true });
      expect(out.status).toBe(0);
      return JSON.parse(out.stdout) as Env;
    }
    const fileStaging = ['VIVERE_ENV=staging', `SUPABASE_URL=${STAGING_URL}`, `SUPABASE_SERVICE_KEY=${SB_SECRET}`];

    it('só o ficheiro (staging correcto): a guarda aceita', () => {
      expect(assertEnvironment(effectiveEnv(fileStaging, {})).environment).toBe('staging');
    });
    it('o processo define SUPABASE_URL de produção e o ficheiro diz staging: o processo VENCE e a guarda bloqueia', () => {
      const env = effectiveEnv(fileStaging, { SUPABASE_URL: PRODUCTION_URL });
      expect(env['SUPABASE_URL']).toBe(PRODUCTION_URL);
      expect(codeOf(env)).toBe('PRODUCTION_BLOCKED');
    });
    it('o processo define VIVERE_ENV=production e o ficheiro diz staging: bloqueia', () => {
      const env = effectiveEnv(fileStaging, { VIVERE_ENV: 'production' });
      expect(codeOf(env)).toBe('PRODUCTION_BLOCKED');
    });
    it('o processo define a confirmação de produção: conflito', () => {
      const env = effectiveEnv(fileStaging, { VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF });
      expect(codeOf(env)).toBe('CONFLICTING_VARIABLES');
    });
    it('o processo define uma chave publishable por cima da do ficheiro: rejeita', () => {
      const env = effectiveEnv(fileStaging, { SUPABASE_SERVICE_KEY: `sb_publishable_${KEY_SENTINEL}_abcdefghij` });
      expect(codeOf(env)).toBe('KEY_NOT_SERVICE_ROLE');
    });
  });
});

// ── 7. Ausência de chamadas de rede ─────────────────────────────────────────
describe('envGuard: ausência de chamadas de rede', () => {
  type Expected = 'OK' | EnvGuardErrorCode;
  const jwt = (ref: string, role: string) => makeJwt({ ref, role });

  // Cada cenário declara o resultado esperado: 'OK' ou o código EXACTO de erro.
  const scenarios: Array<[string, Env, Expected]> = [
    // válidos
    ['staging válido com sb_secret_', validEnv(), 'OK'],
    ['staging válido com JWT legado service_role', validEnv({ SUPABASE_SERVICE_KEY: jwt(STAGING_REF, 'service_role') }), 'OK'],
    // VIVERE_ENV
    ['ambiente vazio {}', {}, 'ENV_MISSING'],
    ['VIVERE_ENV ausente', validEnv({ VIVERE_ENV: undefined }), 'ENV_MISSING'],
    ['VIVERE_ENV vazio', validEnv({ VIVERE_ENV: '' }), 'ENV_MISSING'],
    ['VIVERE_ENV=prod', validEnv({ VIVERE_ENV: 'prod' }), 'ENV_INVALID'],
    ['VIVERE_ENV=STAGING', validEnv({ VIVERE_ENV: 'STAGING' }), 'ENV_INVALID'],
    ['VIVERE_ENV=development', validEnv({ VIVERE_ENV: 'development' }), 'ENV_INVALID'],
    ['VIVERE_ENV=production', validEnv({ VIVERE_ENV: 'production' }), 'PRODUCTION_BLOCKED'],
    [
      'production + URL de produção + confirmação',
      validEnv({ VIVERE_ENV: 'production', SUPABASE_URL: PRODUCTION_URL, VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF }),
      'PRODUCTION_BLOCKED',
    ],
    // conflito
    ['confirmação de produção com staging declarado', validEnv({ VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF }), 'CONFLICTING_VARIABLES'],
    // SUPABASE_URL
    ['SUPABASE_URL ausente', validEnv({ SUPABASE_URL: undefined }), 'URL_MISSING'],
    ['SUPABASE_URL vazio', validEnv({ SUPABASE_URL: '' }), 'URL_MISSING'],
    ['URL com http', validEnv({ SUPABASE_URL: `http://${STAGING_REF}.supabase.co` }), 'URL_INVALID'],
    ['URL com barra final', validEnv({ SUPABASE_URL: `${STAGING_URL}/` }), 'URL_INVALID'],
    ['URL com caminho', validEnv({ SUPABASE_URL: `${STAGING_URL}/rest/v1` }), 'URL_INVALID'],
    ['URL com porta', validEnv({ SUPABASE_URL: `${STAGING_URL}:443` }), 'URL_INVALID'],
    ['URL com credenciais', validEnv({ SUPABASE_URL: `https://user:pw@${STAGING_REF}.supabase.co` }), 'URL_INVALID'],
    ['URL de host que não é Supabase', validEnv({ SUPABASE_URL: `https://${STAGING_REF}.example.com` }), 'URL_INVALID'],
    ['URL com sufixo malicioso', validEnv({ SUPABASE_URL: `${STAGING_URL}.evil.com` }), 'URL_INVALID'],
    ['URL com ref desconhecido', validEnv({ SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' }), 'URL_REF_MISMATCH'],
    ['URL de produção', validEnv({ SUPABASE_URL: PRODUCTION_URL }), 'PRODUCTION_BLOCKED'],
    ['URL de produção com caminho', validEnv({ SUPABASE_URL: `${PRODUCTION_URL}/rest/v1` }), 'PRODUCTION_BLOCKED'],
    // SUPABASE_SERVICE_KEY
    ['chave ausente', validEnv({ SUPABASE_SERVICE_KEY: undefined }), 'KEY_MISSING'],
    ['chave vazia', validEnv({ SUPABASE_SERVICE_KEY: '' }), 'KEY_MISSING'],
    ['chave só com espaços', validEnv({ SUPABASE_SERVICE_KEY: '   ' }), 'KEY_INVALID_FORMAT'],
    ['sb_secret_ curta', validEnv({ SUPABASE_SERVICE_KEY: 'sb_secret_abc' }), 'KEY_INVALID_FORMAT'],
    ['prefixo desconhecido', validEnv({ SUPABASE_SERVICE_KEY: `sk_live_${KEY_SENTINEL}abcdefghij` }), 'KEY_INVALID_FORMAT'],
    ['JWT malformado (2 segmentos)', validEnv({ SUPABASE_SERVICE_KEY: `${b64url({ alg: 'HS256' })}.${b64url({ ref: STAGING_REF })}` }), 'KEY_INVALID_FORMAT'],
    ['JWT sem ref', validEnv({ SUPABASE_SERVICE_KEY: makeJwt({ role: 'service_role' }) }), 'KEY_INVALID_FORMAT'],
    ['chave publishable', validEnv({ SUPABASE_SERVICE_KEY: `sb_publishable_${KEY_SENTINEL}_abcdefghij` }), 'KEY_NOT_SERVICE_ROLE'],
    ['JWT com role anon', validEnv({ SUPABASE_SERVICE_KEY: jwt(STAGING_REF, 'anon') }), 'KEY_NOT_SERVICE_ROLE'],
    ['JWT de outro projecto', validEnv({ SUPABASE_SERVICE_KEY: jwt('aaaaaaaaaaaaaaaaaaaa', 'service_role') }), 'KEY_PROJECT_MISMATCH'],
    ['JWT de produção', validEnv({ SUPABASE_SERVICE_KEY: jwt(PRODUCTION_REF, 'service_role') }), 'PRODUCTION_BLOCKED'],
  ];

  let spies: Array<ReturnType<typeof vi.spyOn>> = [];
  const fetchSpy = vi.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy.mockClear();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    spies = [
      vi.spyOn(http, 'request'),
      vi.spyOn(http, 'get'),
      vi.spyOn(https, 'request'),
      vi.spyOn(https, 'get'),
      vi.spyOn(net.Socket.prototype, 'connect'),
      vi.spyOn(dns, 'lookup'),
      vi.spyOn(dns, 'resolve'),
    ];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const s of spies) s.mockRestore();
  });

  it('nenhum cenário (válido ou inválido) faz fetch, http(s), socket ou DNS, e cada um dá o resultado esperado', () => {
    for (const [label, env, expected] of scenarios) {
      let outcome: Expected = 'OK';
      try {
        assertEnvironment(env);
      } catch (e) {
        expect(e, label).toBeInstanceOf(EnvGuardError);
        outcome = (e as EnvGuardError).code;
      }
      expect({ label, outcome }).toEqual({ label, outcome: expected });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('os cenários cobrem TODOS os códigos de erro da guarda (falha se for criado um código sem cenário)', () => {
    const allCodes: Record<EnvGuardErrorCode, true> = {
      ENV_MISSING: true, ENV_INVALID: true, PRODUCTION_BLOCKED: true, CONFLICTING_VARIABLES: true,
      URL_MISSING: true, URL_INVALID: true, URL_REF_MISMATCH: true,
      KEY_MISSING: true, KEY_INVALID_FORMAT: true, KEY_NOT_SERVICE_ROLE: true, KEY_PROJECT_MISMATCH: true,
    };
    const covered = new Set(scenarios.map(([, , expected]) => expected).filter((e) => e !== 'OK'));
    expect([...covered].sort()).toEqual(Object.keys(allCodes).sort());
    expect(scenarios.filter(([, , e]) => e === 'OK').length).toBeGreaterThanOrEqual(2);
  });

  it('é síncrona: devolve ou lança sem devolver uma Promise', () => {
    const r = assertEnvironment(validEnv());
    expect(r).not.toBeInstanceOf(Promise);
    expect(typeof (r as unknown as { then?: unknown }).then).toBe('undefined');
    expect(() => assertEnvironment({})).toThrow(EnvGuardError);
  });

  describe('análise estática do código da guarda', () => {
    const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const guardSrc = stripComments(read('../envGuard.ts'));
    const configSrc = stripComments(read('../../config/environments.ts'));

    it('envGuard.ts só importa o ficheiro de configuração', () => {
      const imports = [...guardSrc.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
      expect(imports).toEqual(['../config/environments']);
    });
    it('environments.ts não importa nada', () => {
      expect(configSrc).not.toMatch(/^\s*import\s/m);
    });
    it('não usa nenhuma API de rede, de processos, nem o supabase-js', () => {
      for (const forbidden of [
        /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\bhttps?\./, /node:(http|https|net|dns|tls|dgram|child_process)/,
        /@supabase\/supabase-js/, /\brequire\s*\(/, /\bimport\s*\(/,
      ]) {
        expect(guardSrc).not.toMatch(forbidden);
      }
    });
    it('não regista nada (sem console nem logger)', () => {
      expect(guardSrc).not.toMatch(/\bconsole\./);
      expect(guardSrc).not.toMatch(/\blogger\b/);
    });
    it('só lê process.env uma vez, como valor por omissão do parâmetro, e nunca lê NODE_ENV', () => {
      expect((guardSrc.match(/process\.env/g) ?? []).length).toBe(1);
      expect(guardSrc).toMatch(/env:\s*NodeJS\.ProcessEnv\s*=\s*process\.env/);
      expect(guardSrc).not.toMatch(/NODE_ENV/);
    });
  });
});

// ── 8. Ausência de segredos em mensagens de erro ────────────────────────────
describe('envGuard: ausência de segredos em mensagens de erro', () => {
  const URL_SECRET = 'URLSENTINELpass';
  const jwtProd = makeJwt({ ref: PRODUCTION_REF, role: 'service_role' });
  const jwtAnon = makeJwt({ ref: STAGING_REF, role: 'anon' });
  const jwtOther = makeJwt({ ref: 'aaaaaaaaaaaaaaaaaaaa', role: 'service_role' });
  const jwtNoRef = makeJwt({ role: 'service_role' });
  const publishable = `sb_publishable_${KEY_SENTINEL}_abcdefghij`;
  const secretBadShape = `sb_secret_${KEY_SENTINEL}!!`;
  const weirdRole = makeJwt({ ref: STAGING_REF, role: `role-${KEY_SENTINEL}` });
  const spaced = ` ${SB_SECRET} `;
  const badJwtStructure = `${b64url({ alg: 'HS256' })}.${KEY_SENTINEL}.${SIG_SENTINEL}extra.more`;

  const failing: Array<[string, Env]> = [
    ['JWT de produção', validEnv({ SUPABASE_SERVICE_KEY: jwtProd })],
    ['JWT anon', validEnv({ SUPABASE_SERVICE_KEY: jwtAnon })],
    ['JWT de outro projecto', validEnv({ SUPABASE_SERVICE_KEY: jwtOther })],
    ['JWT sem ref', validEnv({ SUPABASE_SERVICE_KEY: jwtNoRef })],
    ['JWT com role desconhecido', validEnv({ SUPABASE_SERVICE_KEY: weirdRole })],
    ['JWT com estrutura inválida', validEnv({ SUPABASE_SERVICE_KEY: badJwtStructure })],
    ['chave publishable', validEnv({ SUPABASE_SERVICE_KEY: publishable })],
    ['sb_secret_ malformada', validEnv({ SUPABASE_SERVICE_KEY: secretBadShape })],
    ['chave com espaços', validEnv({ SUPABASE_SERVICE_KEY: spaced })],
    ['URL com credenciais', validEnv({ SUPABASE_URL: `https://user:${URL_SECRET}@${STAGING_REF}.supabase.co` })],
    ['URL de produção com credenciais', validEnv({ SUPABASE_URL: `https://user:${URL_SECRET}@${PRODUCTION_REF}.supabase.co` })],
    ['URL de produção + chave sb_secret_', validEnv({ SUPABASE_URL: PRODUCTION_URL })],
    ['produção declarada + confirmação', validEnv({ VIVERE_ENV: 'production', VIVERE_PRODUCTION_CONFIRM: PRODUCTION_REF })],
    ['conflito de confirmação', validEnv({ VIVERE_PRODUCTION_CONFIRM: 'segredo-CONFIRMSENTINEL' })],
    ['ambiente inválido', validEnv({ VIVERE_ENV: `valor-${KEY_SENTINEL}` })],
  ];
  const secrets = [KEY_SENTINEL, SIG_SENTINEL, URL_SECRET, 'CONFIRMSENTINEL', SB_SECRET, jwtProd, jwtAnon, jwtOther, jwtNoRef, weirdRole];

  it.each(failing)('falha %s sem expor segredos em message, toString, stack nem JSON', (_label, env) => {
    const err = errorOf(env);
    const blobs = [err.message, String(err), err.stack ?? '', JSON.stringify(err), JSON.stringify({ ...err })];
    for (const blob of blobs) {
      for (const secret of secrets) expect(blob).not.toContain(secret);
    }
    // nenhum segmento de nenhum JWT de teste aparece
    for (const jwt of [jwtProd, jwtAnon, jwtOther, jwtNoRef, weirdRole]) {
      for (const seg of jwt.split('.')) for (const blob of blobs) expect(blob).not.toContain(seg);
    }
    // nem as chaves em bruto nem o prefixo completo de uma chave nova seguido de conteúdo
    for (const blob of blobs) expect(blob).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/);
  });

  it('o código do erro é estável e a mensagem começa por [envGuard:CODIGO]', () => {
    const err = errorOf(validEnv({ VIVERE_ENV: undefined }));
    expect(err.name).toBe('EnvGuardError');
    expect(err.code).toBe('ENV_MISSING');
    expect(err.message.startsWith('[envGuard:ENV_MISSING]')).toBe(true);
  });

  it('o aviso de sucesso e o resultado também não contêm a chave', () => {
    const r = assertEnvironment(validEnv({ SUPABASE_SERVICE_KEY: SB_SECRET }));
    const blob = JSON.stringify(r) + r.warnings.join(' ');
    expect(blob).not.toContain(KEY_SENTINEL);
    expect(blob).not.toContain(SB_SECRET);
  });
});
