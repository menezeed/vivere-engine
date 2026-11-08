/**
 * SEC-B — testes unitários do verificador de JWT (jwtVerifier.ts).
 *
 * Sem rede: o JWKS é servido por um fetch falso controlado pelo teste e o
 * relógio é injectado. Chaves ES256 e RS256 geradas em memória.
 * A numeração (#n) segue o plano de testes do SEC-B-design §4.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  createJwtVerifier,
  resolveJwtEnvConfig,
  type JwtVerifierOptions,
  type VerifyResult,
} from '../middleware/jwtVerifier';

// ── Chaves ──────────────────────────────────────────────────────────────────

const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' } as const;

let keyA: CryptoKeyPair;       // ES256, kid-a
let keyB: CryptoKeyPair;       // ES256, kid-b (rotação)
let keyR: CryptoKeyPair;       // RS256, kid-r
let keyWeakR: CryptoKeyPair;   // RS256 1024 bits
let attacker: CryptoKeyPair;   // ES256 do atacante
let jwkA: JsonWebKey; let jwkB: JsonWebKey; let jwkR: JsonWebKey; let jwkWeakR: JsonWebKey; let jwkAttacker: JsonWebKey;

const pub = (jwk: JsonWebKey, kid: string, extra: Record<string, unknown> = {}) => ({ ...jwk, kid, ...extra });

beforeAll(async () => {
  const ec = () => crypto.subtle.generateKey(EC, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
  [keyA, keyB, attacker] = await Promise.all([ec(), ec(), ec()]);
  keyR = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  keyWeakR = (await crypto.subtle.generateKey({ ...RSA, modulusLength: 1024 }, true, ['sign', 'verify'])) as CryptoKeyPair;
  [jwkA, jwkB, jwkR, jwkWeakR, jwkAttacker] = await Promise.all(
    [keyA, keyB, keyR, keyWeakR, attacker].map((k) => crypto.subtle.exportKey('jwk', k.publicKey)),
  );
});

// ── Tokens ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://proj.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const T0 = 1_800_000_000_000; // ms

const b64u = (b: Uint8Array | ArrayBuffer) => Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b).toString('base64url');
const b64uJson = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');

let clock = T0;
const nowSec = () => clock / 1000;

const claims = (extra: Record<string, unknown> = {}) => ({
  sub: 'user-1', email: 'u@example.test', aud: 'authenticated', role: 'authenticated',
  iss: ISSUER, iat: nowSec(), exp: nowSec() + 3600, app_metadata: { role: 'admin' }, ...extra,
});

async function signWith(key: CryptoKey, header: Record<string, unknown>, body: unknown): Promise<string> {
  const h = b64uJson(header);
  const p = typeof body === 'string' ? Buffer.from(body).toString('base64url') : b64uJson(body);
  const data = new TextEncoder().encode(`${h}.${p}`);
  const algo = key.algorithm.name === 'ECDSA' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: key.algorithm.name };
  return `${h}.${p}.${b64u(await crypto.subtle.sign(algo, key, data))}`;
}
const es = (extra: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key?: CryptoKey) =>
  signWith(key ?? keyA.privateKey, { alg: 'ES256', typ: 'JWT', kid: 'kid-a', ...header }, claims(extra));
const rs = (extra: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key?: CryptoKey) =>
  signWith(key ?? keyR.privateKey, { alg: 'RS256', typ: 'JWT', kid: 'kid-r', ...header }, claims(extra));

// ── JWKS falso ──────────────────────────────────────────────────────────────

type Mode = 'ok' | 'throw' | '500' | 'badjson' | 'empty' | 'hang' | 'hang-abortable' | 'big-content-length' | 'multibyte';
let mode: Mode;
let jwksKeys: unknown[];
let fetchUrls: string[];
let fetchInits: Array<RequestInit | undefined>;

const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  fetchUrls.push(String(url));
  fetchInits.push(init);
  if (String(url) !== JWKS_URL) throw new Error('URL inesperado');
  switch (mode) {
    case 'throw':   throw new Error('ECONNREFUSED');
    case '500':     return new Response('err', { status: 500 });
    case 'badjson': return new Response('{not json', { status: 200 });
    case 'empty':   return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    case 'hang':    return new Promise<Response>(() => undefined);
    case 'big-content-length':
      return new Response(JSON.stringify({ keys: jwksKeys }), { status: 200, headers: { 'content-length': '10000000' } });
    case 'multibyte': // < 64 K caracteres UTF-16, mas > 64 KB em bytes
      return new Response(JSON.stringify({ keys: jwksKeys, pad: 'é'.repeat(40_000) }), { status: 200 });
    case 'hang-abortable':
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    default:        return new Response(JSON.stringify({ keys: jwksKeys }), { status: 200 });
  }
}) as typeof fetch;

const silent = { warn: () => undefined, error: () => undefined };
const make = (o: Partial<JwtVerifierOptions> = {}) =>
  createJwtVerifier({ supabaseUrl: SUPABASE_URL, fetchImpl: fakeFetch, now: () => clock, logger: silent, ...o });

const reason = (r: VerifyResult) => (r.ok ? 'ok' : r.reason);

beforeEach(() => {
  clock = T0;
  mode = 'ok';
  fetchUrls = [];
  fetchInits = [];
  jwksKeys = [pub(jwkA, 'kid-a', { alg: 'ES256', use: 'sig' }), pub(jwkR, 'kid-r', { alg: 'RS256' })];
});

// ── Assinatura / algoritmo ──────────────────────────────────────────────────

describe('assinatura e algoritmo', () => {
  it('#1 ES256 válido com kid, iss, aud e role correctos → ok, payload devolvido', async () => {
    const r = await make().verify(await es());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload['sub']).toBe('user-1');
  });

  it('#2 RS256 válido com kid de chave RSA → ok', async () => {
    expect(reason(await make().verify(await rs()))).toBe('ok');
  });

  it('#3 alg none com assinatura vazia → malformed', async () => {
    const t = `${b64uJson({ alg: 'none', kid: 'kid-a' })}.${b64uJson(claims())}.`;
    expect(reason(await make().verify(t))).toBe('malformed');
  });

  it('#4 alg none com assinatura arbitrária → alg', async () => {
    const t = `${b64uJson({ alg: 'none', kid: 'kid-a' })}.${b64uJson(claims())}.${b64u(new Uint8Array(64).fill(7))}`;
    expect(reason(await make().verify(t))).toBe('alg');
  });

  it('#5 HS256 assinado com a chave pública (JWK e SPKI) como segredo → alg', async () => {
    const v = make();
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyA.publicKey));
    for (const secret of [new TextEncoder().encode(JSON.stringify(pub(jwkA, 'kid-a'))), spki]) {
      const hmac = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const t = await signWith(hmac, { alg: 'HS256', typ: 'JWT', kid: 'kid-a' }, claims());
      expect(reason(await v.verify(t))).toBe('alg');
    }
  });

  it('#6 mismatch alg/kty: ES256 com kid RSA e RS256 com kid EC → alg', async () => {
    const v = make();
    expect(reason(await v.verify(await es({}, { kid: 'kid-r' })))).toBe('alg');
    expect(reason(await v.verify(await rs({}, { kid: 'kid-a' })))).toBe('alg');
  });

  it.each(['ES384', 'ES512', 'PS256', 'EdDSA', 'HS512', 'RS512', 'es256', ''])('#7 alg %s → alg', async (alg) => {
    const t = await signWith(keyA.privateKey, { alg, typ: 'JWT', kid: 'kid-a' }, claims());
    expect(reason(await make().verify(t))).toBe('alg');
  });

  it('#8 assinatura de outra chave com kid publicado → signature', async () => {
    expect(reason(await make().verify(await es({}, {}, attacker.privateKey)))).toBe('signature');
  });

  it('#9 payload adulterado após assinatura → signature', async () => {
    const [h, , s] = (await es()).split('.');
    const forged = `${h}.${b64uJson(claims({ app_metadata: { role: 'admin' }, sub: 'outro' }))}.${s}`;
    expect(reason(await make().verify(forged))).toBe('signature');
  });

  it('#10 jku/x5u/jwk/x5c no header são ignorados → signature, 0 fetches ao atacante', async () => {
    const t = await es({}, {
      jku: 'https://attacker.example/jwks.json',
      x5u: 'https://attacker.example/cert.pem',
      jwk: pub(jwkAttacker, 'kid-a'),
      x5c: ['AAAA'],
    }, attacker.privateKey);
    expect(reason(await make().verify(t))).toBe('signature');
    expect(fetchUrls.every((u) => u === JWKS_URL)).toBe(true);
  });

  it('assinatura ES256 em formato DER (≠ 64 bytes) → signature', async () => {
    const [h, p] = (await es()).split('.');
    expect(reason(await make().verify(`${h}.${p}.${b64u(new Uint8Array(70).fill(1))}`))).toBe('signature');
  });

  it('allowedAlgs só restringe: com [ES256], RS256 → alg; HS256 não pode ser activado', async () => {
    expect(reason(await make({ allowedAlgs: ['ES256'] }).verify(await rs()))).toBe('alg');
    expect(() => make({ allowedAlgs: ['HS256'] })).toThrow();
    expect(reason(await make({ allowedAlgs: ['ES256', 'HS256'] }).verify(await es()))).toBe('ok');
  });
});

// ── Parsing ─────────────────────────────────────────────────────────────────

describe('parsing do token', () => {
  it.each([
    ['vazio', ''],
    ['2 segmentos', 'a.b'],
    ['4 segmentos', 'a.b.c.d'],
    ['caracteres fora de base64url', 'a+b.c.d'],
    ['header não-JSON', `${Buffer.from('xx').toString('base64url')}.e30.AAAA`],
    ['header array', `${b64uJson([1])}.e30.AAAA`],
    ['header null', `${b64uJson(null)}.e30.AAAA`],
    ['demasiado longo', `${'a'.repeat(9000)}.b.c`],
  ])('%s → malformed', async (_l, t) => {
    expect(reason(await make().verify(t))).toBe('malformed');
  });

  it('nunca lança, mesmo com input não-string', async () => {
    await expect(make().verify(undefined as unknown as string)).resolves.toEqual({ ok: false, reason: 'malformed' });
  });

  it('header com crit → malformed; typ diferente de JWT → malformed; typ "jwt" aceite', async () => {
    const v = make();
    expect(reason(await v.verify(await es({}, { crit: ['exp'] })))).toBe('malformed');
    expect(reason(await v.verify(await es({}, { typ: 'at+jwt' })))).toBe('malformed');
    expect(reason(await v.verify(await es({}, { typ: 'jwt' })))).toBe('ok');
  });

  it('payload assinado mas não-JSON → malformed', async () => {
    const t = await signWith(keyA.privateKey, { alg: 'ES256', kid: 'kid-a' }, 'not json');
    expect(reason(await make().verify(t))).toBe('malformed');
  });
});

// ── kid ─────────────────────────────────────────────────────────────────────

describe('kid', () => {
  it('#11 sem kid → kid, sem fetch', async () => {
    expect(reason(await make().verify(await es({}, { kid: undefined })))).toBe('kid');
    expect(fetchUrls).toHaveLength(0);
  });

  it('kid vazio, não-string ou > 128 chars → kid', async () => {
    const v = make();
    for (const kid of ['', 42, 'k'.repeat(129)]) {
      expect(reason(await v.verify(await es({}, { kid })))).toBe('kid');
    }
  });

  it('#12 kid forjado → refresh do JWKS; continua ausente → kid', async () => {
    const v = make();
    await v.verify(await es());                // carga inicial
    clock += 31_000;
    expect(reason(await v.verify(await es({}, { kid: 'forjado' })))).toBe('kid');
    expect(fetchUrls).toHaveLength(2);
  });

  it('#13 rate limit: 50 kids aleatórios em < 30 s → no máximo 1 fetch extra; depois de 30 s, mais 1', async () => {
    const v = make();
    await v.verify(await es());
    expect(fetchUrls).toHaveLength(1);
    clock += 31_000;
    for (let i = 0; i < 50; i++) {
      expect(reason(await v.verify(await es({}, { kid: `rnd-${i}` })))).toBe('kid');
      clock += 100;
    }
    expect(fetchUrls).toHaveLength(2);
    clock += 30_000;
    await v.verify(await es({}, { kid: 'rnd-x' }));
    expect(fetchUrls).toHaveLength(3);
  });

  it('#13b kids aleatórios concorrentes partilham um único refresh', async () => {
    const v = make();
    await v.verify(await es());
    clock += 31_000;
    const tokens = await Promise.all(Array.from({ length: 20 }, (_, i) => es({}, { kid: `c-${i}` })));
    await Promise.all(tokens.map((t) => v.verify(t)));
    expect(fetchUrls).toHaveLength(2);
  });

  it('#14 várias chaves; o token usa a 2.ª → ok (regressão de keys[0])', async () => {
    jwksKeys = [pub(jwkB, 'kid-b'), pub(jwkA, 'kid-a')];
    expect(reason(await make().verify(await es()))).toBe('ok');
  });

  it('#15 JWKs descartadas: use=enc, privada (d), oct, key_ops sem verify, alg declarado divergente, curva errada, RSA < 2048, kid duplicado', async () => {
    const priv = await crypto.subtle.exportKey('jwk', keyB.privateKey);
    jwksKeys = [
      pub(jwkA, 'k-enc', { use: 'enc' }),
      { ...priv, kid: 'k-priv' },
      { kty: 'oct', k: Buffer.from('segredo').toString('base64url'), kid: 'k-oct', alg: 'HS256' },
      pub(jwkA, 'k-ops', { key_ops: ['encrypt'] }),
      pub(jwkA, 'k-alg', { alg: 'RS256' }),
      pub(jwkA, 'k-crv', { crv: 'P-384' }),
      pub(jwkWeakR, 'k-weak'),
      pub(jwkA, 'k-dup'), pub(jwkB, 'k-dup'),
      pub(jwkR, 'kid-r'), // mantém o JWKS com pelo menos uma chave válida
    ];
    const v = make();
    expect(reason(await v.verify(await es({}, { kid: 'k-enc' })))).toBe('kid');
    expect(reason(await v.verify(await es({}, { kid: 'k-priv' }, keyB.privateKey)))).toBe('kid');
    const hmac = await crypto.subtle.importKey('raw', Buffer.from('segredo'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    expect(reason(await v.verify(await signWith(hmac, { alg: 'HS256', kid: 'k-oct' }, claims())))).toBe('alg');
    expect(reason(await v.verify(await es({}, { kid: 'k-ops' })))).toBe('kid');
    expect(reason(await v.verify(await es({}, { kid: 'k-alg' })))).toBe('kid');
    expect(reason(await v.verify(await es({}, { kid: 'k-crv' })))).toBe('kid');
    expect(reason(await v.verify(await rs({}, { kid: 'k-weak' }, keyWeakR.privateKey)))).toBe('kid');
    expect(reason(await v.verify(await es({}, { kid: 'k-dup' })))).toBe('kid');
    expect(reason(await v.verify(await rs()))).toBe('ok');
  });

  it('key_ops com verify e use=sig são aceites', async () => {
    jwksKeys = [pub(jwkA, 'kid-a', { use: 'sig', key_ops: ['verify'] })];
    expect(reason(await make().verify(await es()))).toBe('ok');
  });
});

// ── Rotação / cache ─────────────────────────────────────────────────────────

describe('rotação e cache', () => {
  it('#16 rotação: cache com A; token com kid B (nova) → refresh → ok', async () => {
    const v = make();
    expect(reason(await v.verify(await es()))).toBe('ok');
    jwksKeys = [pub(jwkA, 'kid-a'), pub(jwkB, 'kid-b')];
    clock += 31_000;
    expect(reason(await v.verify(await es({}, { kid: 'kid-b' }, keyB.privateKey)))).toBe('ok');
    expect(fetchUrls).toHaveLength(2);
  });

  it('#17 chave A removida do JWKS: após o TTL, kid A → kid (revogação efectiva)', async () => {
    const v = make();
    expect(reason(await v.verify(await es()))).toBe('ok');
    jwksKeys = [pub(jwkB, 'kid-b')];
    clock += 9 * 60_000;
    expect(reason(await v.verify(await es()))).toBe('ok'); // ainda dentro do TTL (janela documentada)
    clock += 61_000;
    expect(reason(await v.verify(await es()))).toBe('kid');
  });

  it('#18 dentro do TTL não há fetch (1 fetch para N pedidos)', async () => {
    const v = make();
    for (let i = 0; i < 10; i++) {
      expect(reason(await v.verify(await es()))).toBe('ok');
      clock += 30_000;
    }
    expect(fetchUrls).toHaveLength(1);
  });

  it('#19 pedidos concorrentes com cache fria → 1 único fetch (single-flight)', async () => {
    const v = make();
    const tokens = await Promise.all(Array.from({ length: 10 }, () => es()));
    const results = await Promise.all(tokens.map((t) => v.verify(t)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fetchUrls).toHaveLength(1);
  });

  it('warmUp carrega o JWKS (true) e evita fetch no primeiro pedido; falha → false', async () => {
    const v = make();
    expect(await v.warmUp()).toBe(true);
    expect(reason(await v.verify(await es()))).toBe('ok');
    expect(fetchUrls).toHaveLength(1);
    mode = 'throw';
    expect(await make().warmUp()).toBe(false);
  });
});

// ── Falhas do JWKS ──────────────────────────────────────────────────────────

describe('falhas do JWKS', () => {
  it.each(['throw', '500', 'badjson', 'empty'] as const)('#20 %s sem cache → jwks_unavailable, sem excepção', async (m) => {
    mode = m;
    await expect(make().verify(await es())).resolves.toMatchObject({ ok: false, reason: 'jwks_unavailable' });
  });

  it('#20b JWKS só com chaves inutilizáveis → jwks_unavailable', async () => {
    jwksKeys = [{ kty: 'oct', k: 'AAAA', kid: 'x' }];
    expect(reason(await make().verify(await es()))).toBe('jwks_unavailable');
  });

  it('#21 falha com cache de idade < MAX_STALE → continua a aceitar a chave em cache', async () => {
    const v = make();
    expect(reason(await v.verify(await es()))).toBe('ok');
    mode = 'throw';
    clock += 11 * 60_000; // TTL expirado → tenta refresh, falha
    expect(reason(await v.verify(await es()))).toBe('ok');
    expect(fetchUrls).toHaveLength(2);
  });

  it('#22 falha com cache de idade > MAX_STALE → jwks_unavailable (fail-closed)', async () => {
    const v = make();
    expect(reason(await v.verify(await es()))).toBe('ok');
    mode = '500';
    clock += 61 * 60_000;
    expect(reason(await v.verify(await es()))).toBe('jwks_unavailable');
  });

  it('#23 falhas sucessivas não geram fetch por pedido (respeitam minRefreshInterval)', async () => {
    mode = 'throw';
    const v = make();
    for (let i = 0; i < 20; i++) {
      expect(reason(await v.verify(await es()))).toBe('jwks_unavailable');
      clock += 1_000;
    }
    expect(fetchUrls).toHaveLength(1);
    clock += 15_000;
    mode = 'ok';
    expect(reason(await v.verify(await es()))).toBe('ok'); // recupera após o intervalo
    expect(fetchUrls).toHaveLength(2);
  });

  it.each(['hang', 'hang-abortable'] as const)('#24 timeout: fetch %s → abortado em fetchTimeoutMs → jwks_unavailable', async (m) => {
    mode = m;
    const started = Date.now();
    expect(reason(await make({ fetchTimeoutMs: 25 }).verify(await es()))).toBe('jwks_unavailable');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('JWKS demasiado grande (> 64 KB) → jwks_unavailable', async () => {
    jwksKeys = [pub(jwkA, 'kid-a', { pad: 'x'.repeat(70_000) })];
    expect(reason(await make().verify(await es()))).toBe('jwks_unavailable');
  });
});

// ── Claims ──────────────────────────────────────────────────────────────────

describe('claims', () => {
  it.each([
    ['outro projecto', 'https://outro.supabase.co/auth/v1'],
    ['http em vez de https', 'http://proj.supabase.co/auth/v1'],
    ['barra final', `${ISSUER}/`],
    ['sem /auth/v1', SUPABASE_URL],
    ['não-string', 123],
  ])('#25 iss errado (%s) → iss', async (_l, iss) => {
    expect(reason(await make().verify(await es({ iss })))).toBe('iss');
  });

  it('#26 iss ausente → iss', async () => {
    expect(reason(await make().verify(await es({ iss: undefined })))).toBe('iss');
  });

  it('supabaseUrl com barra final é normalizado; override de issuer respeitado', async () => {
    expect(reason(await make({ supabaseUrl: `${SUPABASE_URL}/` }).verify(await es()))).toBe('ok');
    const custom = make({ issuer: 'https://auth.vivere.example/auth/v1' });
    expect(reason(await custom.verify(await es()))).toBe('iss');
    expect(reason(await custom.verify(await es({ iss: 'https://auth.vivere.example/auth/v1' })))).toBe('ok');
  });

  it.each([['anon'], ['service_role'], [''], [['x']], [undefined], [42]])('#27 aud %j → aud', async (aud) => {
    expect(reason(await make().verify(await es({ aud })))).toBe('aud');
  });

  it('#27b aud array que contém authenticated → ok; override de audience', async () => {
    expect(reason(await make().verify(await es({ aud: ['x', 'authenticated'] })))).toBe('ok');
    expect(reason(await make({ audience: 'admin-panel' }).verify(await es()))).toBe('aud');
  });

  it('#28 exp = now - 31 s → exp; exp = now - 10 s → ok (skew 30 s)', async () => {
    const v = make();
    expect(reason(await v.verify(await es({ exp: nowSec() - 31 })))).toBe('exp');
    expect(reason(await v.verify(await es({ exp: nowSec() - 10 })))).toBe('ok');
  });

  it.each([['ausente', undefined], ['string', 'never'], ['null', null], ['Infinity (→ null em JSON)', Infinity]])(
    '#29 exp %s → exp', async (_l, exp) => {
      expect(reason(await make().verify(await es({ exp })))).toBe('exp');
    });

  it('#30 nbf = now + 60 s → nbf; nbf = now + 10 s → ok; nbf não numérico → nbf', async () => {
    const v = make();
    expect(reason(await v.verify(await es({ nbf: nowSec() + 60 })))).toBe('nbf');
    expect(reason(await v.verify(await es({ nbf: nowSec() + 10 })))).toBe('ok');
    expect(reason(await v.verify(await es({ nbf: 'x' })))).toBe('nbf');
  });

  it('#31 iat no futuro além do skew → iat; dentro do skew → ok', async () => {
    const v = make();
    expect(reason(await v.verify(await es({ iat: nowSec() + 120 })))).toBe('iat');
    expect(reason(await v.verify(await es({ iat: nowSec() + 10 })))).toBe('ok');
    expect(reason(await v.verify(await es({ iat: 'x' })))).toBe('iat');
  });

  it.each([['anon'], ['service_role'], [undefined], ['admin']])('#32 role top-level %j → role', async (role) => {
    expect(reason(await make().verify(await es({ role })))).toBe('role');
  });

  it('skew é limitado a [0, 120] s', async () => {
    expect(reason(await make({ clockSkewSec: 10_000 }).verify(await es({ exp: nowSec() - 121 })))).toBe('exp');
    expect(reason(await make({ clockSkewSec: -50 }).verify(await es({ exp: nowSec() - 1 })))).toBe('exp');
  });

  it('#33 claims UTF-8 (acentos, CJK, emoji) descodificados correctamente', async () => {
    const email = 'joão.conceição@exemplo.pt';
    const name = 'Zoë 日本 🙂';
    const r = await make().verify(await es({ email, user_metadata: { name } }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload['email']).toBe(email);
      expect((r.payload['user_metadata'] as Record<string, unknown>)['name']).toBe(name);
    }
  });

  it('claims só são avaliados depois da assinatura (token expirado de outra chave → signature)', async () => {
    expect(reason(await make().verify(await es({ exp: 0, iss: 'x' }, {}, attacker.privateKey)))).toBe('signature');
  });
});

// ── Ajustes pós-revisão (SEC-B-REVISAO P2-1, P2-3, P2-4, P2-5) ─────────────

/** Variante não canónica: muda um bit não usado do último carácter base64url. */
function nonCanonical(seg: string): string {
  const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = ALPH.indexOf(seg[seg.length - 1]!);
  return seg.slice(0, -1) + ALPH[last ^ 1];
}

describe('ajustes pós-revisão', () => {
  it('P2-1 fábrica normaliza supabaseUrl por URL.origin (maiúsculas, :443, barra final)', async () => {
    const v = make({ supabaseUrl: 'https://PROJ.Supabase.co:443/' });
    expect(reason(await v.verify(await es()))).toBe('ok');
    expect(fetchUrls).toEqual([JWKS_URL]);
  });

  it.each(['https://proj.supabase.co/#', 'https://proj.supabase.co/?', 'https://proj.supabase.co/x', 'ftp://proj.supabase.co'])(
    'P2-1 fábrica recusa supabaseUrl %s', (u) => {
      expect(() => make({ supabaseUrl: u })).toThrow();
    });

  it('P2-1 issuer com barra final é normalizado; issuer com # ou ? recusado', async () => {
    expect(reason(await make({ issuer: `${ISSUER}/` }).verify(await es()))).toBe('ok');
    expect(() => make({ issuer: `${ISSUER}#` })).toThrow();
    expect(() => make({ issuer: `${ISSUER}?a=1` })).toThrow();
  });

  it('P2-3 RSA de 1024 bits com n prefixado por zeros (aparenta 2048) → descartada', async () => {
    const n = Buffer.concat([Buffer.alloc(128), Buffer.from(jwkWeakR.n!, 'base64url')]).toString('base64url');
    expect(Buffer.from(n, 'base64url').length * 8).toBeGreaterThanOrEqual(2048);
    jwksKeys = [pub({ ...jwkWeakR, n }, 'k-padded'), pub(jwkA, 'kid-a')];
    const v = make();
    expect(reason(await v.verify(await rs({}, { kid: 'k-padded' }, keyWeakR.privateKey)))).toBe('kid');
    expect(reason(await v.verify(await es()))).toBe('ok');
  });

  it('P2-3 RSA de 2048 bits continua aceite', async () => {
    expect(reason(await make().verify(await rs()))).toBe('ok');
  });

  it('P2-4 content-length acima do limite → jwks_unavailable', async () => {
    mode = 'big-content-length';
    expect(reason(await make().verify(await es()))).toBe('jwks_unavailable');
  });

  it('P2-4 limite medido em bytes (multibyte < 64 K caracteres mas > 64 KB) → jwks_unavailable', async () => {
    mode = 'multibyte';
    expect(reason(await make().verify(await es()))).toBe('jwks_unavailable');
  });

  it('P2-4 fetch do JWKS com redirect: error', async () => {
    await make().verify(await es());
    expect(fetchInits).toHaveLength(1);
    expect(fetchInits[0]?.redirect).toBe('error');
  });

  it('P2-5 base64url não canónico em qualquer segmento → malformed', async () => {
    const v = make();
    const [h, p, sig] = (await es()).split('.') as [string, string, string];
    expect(reason(await v.verify(`${h}.${p}.${sig}`))).toBe('ok');
    const altSig = nonCanonical(sig);
    expect(Buffer.from(altSig, 'base64url').equals(Buffer.from(sig, 'base64url'))).toBe(true); // mesmos bytes
    expect(reason(await v.verify(`${h}.${p}.${altSig}`))).toBe('malformed');
    // header/payload: só testáveis quando o comprimento deixa bits livres
    for (const [i, seg] of [h, p].entries()) {
      if (seg.length % 4 === 0) continue;
      const parts = [h, p, sig];
      parts[i] = nonCanonical(seg);
      expect(reason(await v.verify(parts.join('.')))).toBe('malformed');
    }
    expect(reason(await v.verify(`${h}.${p}.${sig}=`))).toBe('malformed');
  });
});

// ── Configuração por ambiente ───────────────────────────────────────────────

describe('resolveJwtEnvConfig', () => {
  it('defaults derivados de SUPABASE_URL (barra final removida)', () => {
    expect(resolveJwtEnvConfig({ SUPABASE_URL: `${SUPABASE_URL}/` })).toEqual({
      supabaseUrl: SUPABASE_URL, issuer: ISSUER, audience: 'authenticated',
    });
  });

  it('overrides de issuer e audience', () => {
    expect(resolveJwtEnvConfig({
      SUPABASE_URL, SUPABASE_JWT_ISSUER: 'https://auth.example/auth/v1', SUPABASE_JWT_AUDIENCE: 'aud-x',
    })).toMatchObject({ issuer: 'https://auth.example/auth/v1', audience: 'aud-x' });
  });

  it.each([
    ['maiúsculas no host', 'https://PROJ.SUPABASE.CO'],
    ['porta :443 explícita', 'https://proj.supabase.co:443'],
    ['barra final', 'https://proj.supabase.co/'],
    ['várias barras finais', 'https://proj.supabase.co//'],
    ['espaços', '  https://proj.supabase.co  '],
  ])('P2-1 SUPABASE_URL com %s → normalizado para a origem', (_l, url) => {
    expect(resolveJwtEnvConfig({ SUPABASE_URL: url })).toEqual({
      supabaseUrl: SUPABASE_URL, issuer: ISSUER, audience: 'authenticated',
    });
  });

  it('P2-1 SUPABASE_JWT_ISSUER com barra final é normalizado', () => {
    expect(resolveJwtEnvConfig({ SUPABASE_URL, SUPABASE_JWT_ISSUER: 'https://Auth.Example/auth/v1/' }).issuer)
      .toBe('https://auth.example/auth/v1');
  });

  it('http://localhost só fora de produção', () => {
    expect(resolveJwtEnvConfig({ SUPABASE_URL: 'http://localhost:54321' }).supabaseUrl).toBe('http://localhost:54321');
    expect(() => resolveJwtEnvConfig({ SUPABASE_URL: 'http://localhost:54321', NODE_ENV: 'production' })).toThrow();
  });

  it.each([
    ['ausente', {}],
    ['vazio', { SUPABASE_URL: '' }],
    ['http remoto', { SUPABASE_URL: 'http://proj.supabase.co' }],
    ['com caminho', { SUPABASE_URL: 'https://proj.supabase.co/rest' }],
    ['com query', { SUPABASE_URL: 'https://proj.supabase.co?x=1' }],
    ['com ? vazio', { SUPABASE_URL: 'https://proj.supabase.co/?' }],
    ['com # vazio', { SUPABASE_URL: 'https://proj.supabase.co/#' }],
    ['com fragmento', { SUPABASE_URL: 'https://proj.supabase.co#x' }],
    ['issuer com #', { SUPABASE_URL, SUPABASE_JWT_ISSUER: 'https://proj.supabase.co/auth/v1#' }],
    ['issuer com ?', { SUPABASE_URL, SUPABASE_JWT_ISSUER: 'https://proj.supabase.co/auth/v1?' }],
    ['issuer com credenciais', { SUPABASE_URL, SUPABASE_JWT_ISSUER: 'https://u:p@proj.supabase.co/auth/v1' }],
    ['issuer não-URL', { SUPABASE_URL, SUPABASE_JWT_ISSUER: 'auth/v1' }],
    ['com credenciais', { SUPABASE_URL: 'https://u:p@proj.supabase.co' }],
    ['não-URL', { SUPABASE_URL: 'proj' }],
    ['issuer http remoto', { SUPABASE_URL, SUPABASE_JWT_ISSUER: 'http://evil.example/auth/v1' }],
  ])('rejeita SUPABASE_URL/issuer %s', (_l, env) => {
    expect(() => resolveJwtEnvConfig(env as Record<string, string>)).toThrow();
  });

  it('createJwtVerifier sem supabaseUrl lança (fail-closed na criação)', () => {
    expect(() => createJwtVerifier({ supabaseUrl: '' })).toThrow();
  });
});
