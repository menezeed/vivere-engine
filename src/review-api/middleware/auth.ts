import type { Context, Next } from 'hono';
import type { AuthUser, UserRole } from '../types/reviewTypes';
import { logger } from '../../lib/logger.js';
import { createJwtVerifier, resolveJwtEnvConfig, type JwtVerifier } from './jwtVerifier.js';

/**
 * Middleware de autenticação via JWT do Supabase.
 *
 * SEC-B: a verificação (kid, allowlist de alg, JWKS com TTL/refresh, iss, aud,
 * exp/nbf/iat com skew, role top-level) vive em jwtVerifier.ts. Aqui só se
 * extrai o Bearer, se delega no verificador e se aplica o papel explícito
 * (SEC-A). O motivo da rejeição vai para o log (warn), nunca para a resposta.
 */

let defaultVerifier: JwtVerifier | null = null;
let defaultVerifierErrorLogged = false;

/** Verificador por omissão, criado a partir do ambiente na primeira utilização. */
function getDefaultVerifier(): JwtVerifier | null {
  if (defaultVerifier) return defaultVerifier;
  try {
    defaultVerifier = createJwtVerifier(resolveJwtEnvConfig(process.env));
    return defaultVerifier;
  } catch (err) {
    if (!defaultVerifierErrorLogged) {
      defaultVerifierErrorLogged = true;
      logger.error(
        { err: err instanceof Error ? err.message : 'erro desconhecido' },
        'SEC-B: configuração JWT inválida — todos os pedidos autenticados serão recusados (401)',
      );
    }
    return null; // fail-closed
  }
}

/**
 * Cria o middleware de autenticação. Sem `verifier`, usa o verificador por
 * omissão (SUPABASE_URL / SUPABASE_JWT_ISSUER / SUPABASE_JWT_AUDIENCE).
 */
export function createAuthMiddleware(verifier?: JwtVerifier) {
  return async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Token de autenticação ausente' }, 401);
    }

    const active = verifier ?? getDefaultVerifier();
    const result = active
      ? await active.verify(authHeader.slice(7))
      : { ok: false as const, reason: 'jwks_unavailable' as const, kid: undefined };

    if (!result.ok) {
      // Nunca registar o token, o payload nem o email.
      logger.warn({ reason: result.reason, kid: result.kid }, 'SEC-B: JWT recusado');
      return c.json({ error: 'Token inválido ou expirado' }, 401);
    }

    // SEC-A: token válido não basta — é preciso um papel explícito.
    const user = resolveAuthUser(result.payload);
    if (!user) {
      return c.json({ error: 'Conta sem papel autorizado para o Review API' }, 403);
    }

    c.set('user', user);
    await next();
  };
}

/** Middleware com o verificador por omissão (configurado por ambiente). */
export const authMiddleware = createAuthMiddleware();

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
