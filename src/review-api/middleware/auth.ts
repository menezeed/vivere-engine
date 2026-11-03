import type { Context, Next } from 'hono';
import type { AuthUser, UserRole } from '../types/reviewTypes';

/**
 * Middleware de autenticação via JWT do Supabase.
 *
 * O Supabase novo usa ES256 (assimétrico) em vez de HS256 (simétrico).
 * Obtemos a chave pública via JWKS endpoint e verificamos a assinatura.
 * A chave pública é cacheada em memória — buscada apenas uma vez por processo.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
let cachedPublicKey: CryptoKey | null = null;

async function getPublicKey(): Promise<CryptoKey> {
  if (cachedPublicKey) return cachedPublicKey;

  const jwksUrl = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error(`Falha ao buscar JWKS: ${res.status}`);

  const jwks = await res.json() as { keys: JsonWebKey[] };
  const jwk = jwks.keys[0];

  cachedPublicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  return cachedPublicKey;
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function verifyJWT(token: string): Promise<Record<string, unknown> | null> {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    if (!headerB64 || !payloadB64 || !signatureB64) return null;

    const publicKey = await getPublicKey();

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64urlDecode(signatureB64);

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature.buffer as ArrayBuffer,
      data,
    );

    if (!valid) return null;

    const payload = JSON.parse(
      atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))
    );

    // Verificar expiração. SEC-A: exp é obrigatório — um token sem
    // expiração nunca é aceite.
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Token de autenticação ausente' }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token);

  if (!payload) {
    return c.json({ error: 'Token inválido ou expirado' }, 401);
  }

  // SEC-A: token válido não basta — é preciso um papel explícito.
  const user = resolveAuthUser(payload);
  if (!user) {
    return c.json({ error: 'Conta sem papel autorizado para o Review API' }, 403);
  }

  c.set('user', user);
  await next();
}

/** Papéis aceites pelo Review API (ADR-0009). Não há papel por omissão. */
export const VALID_ROLES: readonly UserRole[] = ['viewer', 'reviewer', 'admin'];

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

/**
 * SEC-A: converte o payload de um JWT JÁ VERIFICADO no utilizador da API.
 * Função pura. Devolve null (→ 403) quando:
 *  - o papel não está em app_metadata.role (user_metadata é editável pelo
 *    próprio utilizador e nunca é lido);
 *  - o papel não é viewer, reviewer ou admin;
 *  - o token é de uma sessão anónima (is_anonymous === true);
 *  - falta o sub.
 */
export function resolveAuthUser(payload: Record<string, unknown>): AuthUser | null {
  if (payload['is_anonymous'] === true) return null;

  const sub = payload['sub'];
  if (typeof sub !== 'string' || sub === '') return null;

  const appMeta = payload['app_metadata'];
  if (typeof appMeta !== 'object' || appMeta === null || Array.isArray(appMeta)) return null;

  const role = (appMeta as Record<string, unknown>)['role'];
  if (!isUserRole(role)) return null;

  const email = payload['email'];
  return { id: sub, email: typeof email === 'string' ? email : '', role };
}

export function requireRole(...roles: UserRole[]) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = c.get('user') as AuthUser | undefined;
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: `Requer role: ${roles.join(' ou ')}` }, 403);
    }
    await next();
  };
}
