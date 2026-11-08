/**
 * SEC-B — verificação de JWT do Supabase para o Review API.
 *
 * WebCrypto nativo + Buffer (Node 22), sem dependências. Fábrica com fetch e
 * relógio injectáveis para que rotação, falhas de rede e skew sejam testáveis.
 *
 * Regras (ver SEC-B-design §3):
 *  - allowlist fixa de algoritmos (ES256, RS256); `none`, HS*, PS*, ES384/512,
 *    EdDSA e qualquer outro → 'alg'. A allowlist só pode ser restringida.
 *  - a chave é escolhida por `kid` (obrigatório); o algoritmo vem da JWK e tem
 *    de coincidir com o `alg` do header (fecha HS256-com-chave-pública).
 *  - `jku`, `x5u`, `jwk`, `x5c` do header são ignorados: nunca se buscam
 *    chaves indicadas pelo token. `crit` → rejeitado.
 *  - JWKS em cache com TTL (10 min), refresh single-flight, refresh forçado
 *    por `kid` desconhecido limitado a 1 tentativa por `minRefreshIntervalMs`,
 *    timeout no fetch, stale-while-error até `maxStaleMs` e depois fail-closed.
 *  - claims (só depois da assinatura válida): exp obrigatório, nbf/iat se
 *    presentes, iss exacto, aud, role top-level 'authenticated'; skew limitado.
 *  - nunca lança para fora: qualquer erro → { ok: false }.
 */

import { logger as defaultLogger } from '../../lib/logger.js';

export type SupportedAlg = 'ES256' | 'RS256';
export const SUPPORTED_ALGS: readonly SupportedAlg[] = ['ES256', 'RS256'];

export type VerifyFailureReason =
  | 'malformed'
  | 'alg'
  | 'kid'
  | 'signature'
  | 'exp'
  | 'nbf'
  | 'iat'
  | 'iss'
  | 'aud'
  | 'role'
  | 'jwks_unavailable';

export type VerifyResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: VerifyFailureReason; kid?: string };

export interface JwtVerifier {
  verify(token: string): Promise<VerifyResult>;
  /** Carrega o JWKS uma vez (pré-aquecimento no arranque). Nunca lança. */
  warmUp(): Promise<boolean>;
}

export interface VerifierLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface JwtVerifierOptions {
  /** Origem do projecto Supabase, sem barra final (normalizada aqui). */
  supabaseUrl: string;
  /** Default `${supabaseUrl}/auth/v1`. */
  issuer?: string;
  /** Default 'authenticated'. */
  audience?: string;
  /** Só pode restringir SUPPORTED_ALGS. */
  allowedAlgs?: readonly string[];
  fetchImpl?: typeof fetch;
  /** Relógio em ms. */
  now?: () => number;
  cacheTtlMs?: number;
  minRefreshIntervalMs?: number;
  maxStaleMs?: number;
  fetchTimeoutMs?: number;
  clockSkewSec?: number;
  logger?: VerifierLogger;
}

export const JWT_DEFAULTS = {
  audience:             'authenticated',
  requiredRole:         'authenticated',
  cacheTtlMs:           10 * 60_000,
  minRefreshIntervalMs: 30_000,
  maxStaleMs:           60 * 60_000,
  fetchTimeoutMs:       3_000,
  clockSkewSec:         30,
  maxClockSkewSec:      120,
  maxTokenLength:       8_192,
  maxKidLength:         128,
  maxJwksBytes:         64 * 1024,
  minRsaModulusBits:    2_048,
} as const;

interface KeyEntry {
  alg: SupportedAlg;
  key: CryptoKey;
}

const SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * base64url canónico (P2-5): o Buffer ignora bits finais não usados, por isso
 * várias strings descodificam para os mesmos bytes. Só a forma canónica
 * (re-codificação idêntica, sem padding) é aceite.
 */
function isCanonicalB64url(seg: string): boolean {
  return SEGMENT.test(seg) && Buffer.from(seg, 'base64url').toString('base64url') === seg;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function decodeJsonSegment(seg: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * P2-1: normaliza um URL base com `new URL()`. Recusa (null) `?`, `#`,
 * credenciais, protocolos fora de https (http só para localhost/127.0.0.1
 * fora de produção) e, sem `allowPath`, qualquer caminho. Devolve
 * `URL.origin` (host em minúsculas, sem porta por omissão) + caminho sem
 * barra final.
 */
export function normalizeBaseUrl(
  raw: string,
  { production = false, allowPath = false }: { production?: boolean; allowPath?: boolean } = {},
): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.includes('?') || s.includes('#')) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.username || u.password) return null;
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local && !production))) return null;
  const path = u.pathname.replace(/\/+$/, '');
  if (!allowPath && path !== '') return null;
  return u.origin + path;
}

/**
 * P2-4: lê o corpo com limite em BYTES: recusa content-length acima do limite
 * e corta a leitura do stream assim que o excede (não bufferiza tudo antes).
 */
async function readBodyCapped(res: Response, capBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > capBytes) throw new Error('JWKS demasiado grande (content-length)');
  if (!res.body) throw new Error('JWKS sem corpo');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > capBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('JWKS demasiado grande');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const ALG_PARAMS: Record<SupportedAlg, {
  importAlg: EcKeyImportParams | RsaHashedImportParams;
  verifyAlg: EcdsaParams | AlgorithmIdentifier;
}> = {
  ES256: {
    importAlg: { name: 'ECDSA', namedCurve: 'P-256' },
    verifyAlg: { name: 'ECDSA', hash: 'SHA-256' },
  },
  RS256: {
    importAlg: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verifyAlg: { name: 'RSASSA-PKCS1-v1_5' },
  },
};

/**
 * Converte uma JWK publicada numa entrada utilizável, ou null se tiver de ser
 * descartada (privada, simétrica, uso/ops errados, tipo/curva/alg fora da
 * allowlist, RSA < 2048 bits, import falhado).
 */
async function toKeyEntry(raw: unknown, allowed: ReadonlySet<SupportedAlg>): Promise<[string, KeyEntry] | null> {
  if (!isPlainObject(raw)) return null;
  const kid = raw['kid'];
  if (typeof kid !== 'string' || kid === '' || kid.length > JWT_DEFAULTS.maxKidLength) return null;
  if ('d' in raw || raw['kty'] === 'oct') return null;           // material privado / simétrico
  if (raw['use'] !== undefined && raw['use'] !== 'sig') return null;
  const ops = raw['key_ops'];
  if (ops !== undefined && (!Array.isArray(ops) || !ops.includes('verify'))) return null;

  let alg: SupportedAlg;
  let clean: JsonWebKey;
  if (raw['kty'] === 'EC' && raw['crv'] === 'P-256'
      && typeof raw['x'] === 'string' && typeof raw['y'] === 'string') {
    alg = 'ES256';
    clean = { kty: 'EC', crv: 'P-256', x: raw['x'], y: raw['y'] };
  } else if (raw['kty'] === 'RSA' && typeof raw['n'] === 'string' && typeof raw['e'] === 'string') {
    alg = 'RS256';
    clean = { kty: 'RSA', n: raw['n'], e: raw['e'] };
  } else {
    return null;
  }
  if (raw['alg'] !== undefined && raw['alg'] !== alg) return null;
  if (!allowed.has(alg)) return null;

  try {
    const key = await crypto.subtle.importKey('jwk', clean, ALG_PARAMS[alg].importAlg, false, ['verify']);
    // P2-3: medir na chave importada (zeros à esquerda em `n` não contam).
    if (alg === 'RS256'
        && (key.algorithm as RsaHashedKeyAlgorithm).modulusLength < JWT_DEFAULTS.minRsaModulusBits) return null;
    if (alg === 'ES256' && (key.algorithm as EcKeyAlgorithm).namedCurve !== 'P-256') return null;
    return [kid, { alg, key }];
  } catch {
    return null;
  }
}

export function createJwtVerifier(opts: JwtVerifierOptions): JwtVerifier {
  const supabaseUrl = normalizeBaseUrl(opts.supabaseUrl);
  if (!supabaseUrl) throw new Error('createJwtVerifier: supabaseUrl em falta ou inválido (origem https)');

  const issuer = opts.issuer === undefined ? `${supabaseUrl}/auth/v1` : normalizeBaseUrl(opts.issuer, { allowPath: true });
  if (!issuer) throw new Error('createJwtVerifier: issuer inválido');
  const audience = opts.audience ?? JWT_DEFAULTS.audience;
  const jwksUrl  = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;

  const requestedAlgs = opts.allowedAlgs ?? SUPPORTED_ALGS;
  const allowedAlgs = new Set<SupportedAlg>(
    SUPPORTED_ALGS.filter((a) => requestedAlgs.includes(a)),
  );
  if (allowedAlgs.size === 0) throw new Error('createJwtVerifier: allowedAlgs vazio ou fora de ES256/RS256');

  const fetchImpl  = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now        = opts.now ?? Date.now;
  const ttl        = opts.cacheTtlMs ?? JWT_DEFAULTS.cacheTtlMs;
  const minRefresh = opts.minRefreshIntervalMs ?? JWT_DEFAULTS.minRefreshIntervalMs;
  const maxStale   = opts.maxStaleMs ?? JWT_DEFAULTS.maxStaleMs;
  const timeoutMs  = opts.fetchTimeoutMs ?? JWT_DEFAULTS.fetchTimeoutMs;
  const skewSec    = Math.min(Math.max(opts.clockSkewSec ?? JWT_DEFAULTS.clockSkewSec, 0), JWT_DEFAULTS.maxClockSkewSec);
  const log        = opts.logger ?? defaultLogger;

  // ── Estado da cache ──────────────────────────────────────────────────────
  let keys: Map<string, KeyEntry> | null = null; // último conjunto carregado com sucesso
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<void> | null = null;

  async function loadJwks(): Promise<Map<string, KeyEntry>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`timeout ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      const body = await Promise.race([
        (async () => {
          const res = await fetchImpl(jwksUrl, {
            signal:   controller.signal,
            redirect: 'error',
            headers:  { accept: 'application/json' },
          });
          if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
          return readBodyCapped(res, JWT_DEFAULTS.maxJwksBytes);
        })(),
        timeout,
      ]);
      const parsed: unknown = JSON.parse(body);
      if (!isPlainObject(parsed) || !Array.isArray(parsed['keys'])) throw new Error('JWKS sem array keys');

      const entries = (await Promise.all(parsed['keys'].map((k) => toKeyEntry(k, allowedAlgs))))
        .filter((e): e is [string, KeyEntry] => e !== null);
      // kid duplicado é ambíguo: descarta todas as ocorrências.
      const counts = new Map<string, number>();
      for (const [kid] of entries) counts.set(kid, (counts.get(kid) ?? 0) + 1);
      const map = new Map(entries.filter(([kid]) => counts.get(kid) === 1));
      if (map.size === 0) throw new Error('JWKS sem chaves utilizáveis');
      return map;
    } finally {
      clearTimeout(timer);
    }
  }

  function refresh(): Promise<void> {
    if (inflight) return inflight;
    lastAttemptAt = now();
    inflight = (async () => {
      try {
        const loaded = await loadJwks();
        keys = loaded;
        fetchedAt = now();
      } catch (err) {
        log.error(
          { jwks_error: err instanceof Error ? err.message : 'erro desconhecido', has_cached_keys: keys !== null },
          'SEC-B: falha ao carregar JWKS do Supabase',
        );
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  const canAttempt = () => now() - lastAttemptAt >= minRefresh;
  const usable = () => keys !== null && now() - fetchedAt <= maxStale;

  async function getKey(kid: string): Promise<KeyEntry | 'kid' | 'jwks_unavailable'> {
    if (inflight) {
      await inflight;
    } else if ((keys === null || now() - fetchedAt >= ttl) && canAttempt()) {
      await refresh();
    }
    if (!usable()) return 'jwks_unavailable';

    let entry = keys!.get(kid);
    if (!entry) {
      // kid desconhecido: possível rotação. Refresh limitado por minRefresh.
      if (inflight) await inflight;
      else if (canAttempt()) await refresh();
      else return 'kid';
      if (!usable()) return 'jwks_unavailable';
      entry = keys!.get(kid);
    }
    return entry ?? 'kid';
  }

  async function verifyInner(token: string): Promise<VerifyResult> {
    if (typeof token !== 'string' || token.length === 0 || token.length > JWT_DEFAULTS.maxTokenLength) {
      return { ok: false, reason: 'malformed' };
    }
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every(isCanonicalB64url)) return { ok: false, reason: 'malformed' };
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    const header = decodeJsonSegment(headerB64);
    if (!header) return { ok: false, reason: 'malformed' };
    if ('crit' in header) return { ok: false, reason: 'malformed' };
    const typ = header['typ'];
    if (typ !== undefined && (typeof typ !== 'string' || typ.toUpperCase() !== 'JWT')) {
      return { ok: false, reason: 'malformed' };
    }
    // jku / x5u / jwk / x5c: ignorados de propósito.

    const alg = header['alg'];
    if (typeof alg !== 'string' || !allowedAlgs.has(alg as SupportedAlg)) return { ok: false, reason: 'alg' };

    const kid = header['kid'];
    if (typeof kid !== 'string' || kid === '' || kid.length > JWT_DEFAULTS.maxKidLength) {
      return { ok: false, reason: 'kid' };
    }

    const entry = await getKey(kid);
    if (entry === 'kid' || entry === 'jwks_unavailable') return { ok: false, reason: entry, kid };
    if (entry.alg !== alg) return { ok: false, reason: 'alg', kid };

    const signature = Buffer.from(signatureB64, 'base64url');
    if (entry.alg === 'ES256' && signature.length !== 64) return { ok: false, reason: 'signature', kid };

    const valid = await crypto.subtle.verify(
      ALG_PARAMS[entry.alg].verifyAlg,
      entry.key,
      signature,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return { ok: false, reason: 'signature', kid };

    // ── Claims (só depois da assinatura válida) ────────────────────────────
    const payload = decodeJsonSegment(payloadB64);
    if (!payload) return { ok: false, reason: 'malformed', kid };
    const nowSec = now() / 1000;

    const exp = payload['exp'];
    if (!isFiniteNumber(exp) || nowSec > exp + skewSec) return { ok: false, reason: 'exp', kid };

    const nbf = payload['nbf'];
    if (nbf !== undefined && (!isFiniteNumber(nbf) || nowSec + skewSec < nbf)) return { ok: false, reason: 'nbf', kid };

    const iat = payload['iat'];
    if (iat !== undefined && (!isFiniteNumber(iat) || iat > nowSec + skewSec)) return { ok: false, reason: 'iat', kid };

    if (payload['iss'] !== issuer) return { ok: false, reason: 'iss', kid };

    const aud = payload['aud'];
    const audOk = typeof aud === 'string'
      ? aud === audience
      : Array.isArray(aud) && aud.some((a) => a === audience);
    if (!audOk) return { ok: false, reason: 'aud', kid };

    if (payload['role'] !== JWT_DEFAULTS.requiredRole) return { ok: false, reason: 'role', kid };

    return { ok: true, payload };
  }

  return {
    async verify(token: string): Promise<VerifyResult> {
      try {
        return await verifyInner(token);
      } catch {
        return { ok: false, reason: 'malformed' };
      }
    },
    async warmUp(): Promise<boolean> {
      try {
        await refresh();
        return keys !== null;
      } catch {
        return false;
      }
    },
  };
}

// ── Configuração a partir do ambiente (server.ts) ──────────────────────────

export interface JwtEnvConfig {
  supabaseUrl: string;
  issuer: string;
  audience: string;
}

/**
 * Lê e valida a configuração JWT (P2-1: normalizada por `new URL()`). Lança
 * Error (sem valores sensíveis — URLs do Supabase não são segredos) quando
 * inválida; server.ts termina o processo.
 */
export function resolveJwtEnvConfig(env: Record<string, string | undefined> = process.env): JwtEnvConfig {
  const production = env['NODE_ENV'] === 'production';
  const rawUrl = env['SUPABASE_URL']?.trim();
  if (!rawUrl) throw new Error('SUPABASE_URL não está definido');
  const supabaseUrl = normalizeBaseUrl(rawUrl, { production });
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL tem de ser uma origem https (http só para localhost fora de produção), sem caminho, query, fragmento nem credenciais');
  }

  const issuerRaw = env['SUPABASE_JWT_ISSUER']?.trim();
  let issuer = `${supabaseUrl}/auth/v1`;
  if (issuerRaw) {
    const normalized = normalizeBaseUrl(issuerRaw, { production, allowPath: true });
    if (!normalized) {
      throw new Error('SUPABASE_JWT_ISSUER tem de ser um URL https (http só para localhost fora de produção), sem query, fragmento nem credenciais');
    }
    issuer = normalized;
  }
  const audienceRaw = env['SUPABASE_JWT_AUDIENCE']?.trim();

  return { supabaseUrl, issuer, audience: audienceRaw || JWT_DEFAULTS.audience };
}
