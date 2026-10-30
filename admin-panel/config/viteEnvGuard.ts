/**
 * Guarda de ambiente do Admin Panel (SEC-O, F-04).
 *
 * Problema: as variáveis VITE_* são embutidas no bundle do browser e, até
 * aqui, nada verificava para que projecto Supabase apontavam. O painel
 * fazia login no Auth de PRODUÇÃO enquanto a Review API (src/lib/envGuard.ts)
 * só arranca contra o STAGING — tokens de um projecto a falar com a API do
 * outro.
 *
 * Decisão F-04: tudo em staging até à Fase 3. Esta guarda corre no
 * vite.config.ts (dev e build) e falha ANTES de servir ou gerar o bundle se:
 *   - VITE_SUPABASE_URL não for exactamente o URL do staging;
 *   - VITE_SUPABASE_ANON_KEY não for uma chave pública do staging;
 *   - qualquer VITE_* contiver uma chave privilegiada (sb_secret_ ou JWT
 *     service_role), que ficaria exposta a todos os utilizadores do browser;
 *   - VITE_API_BASE_URL estiver ausente ou não for http(s).
 *
 * Função SÍNCRONA, PURA e SEM REDE. As mensagens nunca incluem valores.
 */
import { SUPABASE_PROJECT_REFS, supabaseUrlFor } from '../../src/config/environments';

export type AdminEnvGuardErrorCode =
  | 'PRIVILEGED_KEY_EXPOSED'
  | 'PRODUCTION_BLOCKED'
  | 'URL_MISSING'
  | 'URL_NOT_STAGING'
  | 'ANON_KEY_MISSING'
  | 'ANON_KEY_INVALID'
  | 'API_URL_INVALID';

export class AdminEnvGuardError extends Error {
  readonly code: AdminEnvGuardErrorCode;

  constructor(code: AdminEnvGuardErrorCode, message: string) {
    super(`[adminEnvGuard:${code}] ${message}`);
    this.name = 'AdminEnvGuardError';
    this.code = code;
  }
}

const STAGING_REF = SUPABASE_PROJECT_REFS.staging;
const PRODUCTION_REF = SUPABASE_PROJECT_REFS.production;
const STAGING_URL = supabaseUrlFor('staging');
const PUBLISHABLE_SHAPE = /^sb_publishable_[A-Za-z0-9_-]{16,}$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function jwtClaims(raw: string): Record<string, unknown> | null {
  if (!JWT_SHAPE.test(raw)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(raw.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isPrivileged(raw: string): boolean {
  if (raw.startsWith('sb_secret_')) return true;
  const role = jwtClaims(raw)?.['role'];
  return role === 'service_role' || role === 'supabase_admin';
}

/**
 * Lança AdminEnvGuardError se o ambiente do Admin Panel não for exactamente
 * o staging declarado. Recebe o objecto devolvido por loadEnv() do Vite.
 */
export function assertAdminPanelEnv(env: Record<string, string | undefined>): void {
  // 1. Nenhuma chave privilegiada pode entrar no bundle, em variável nenhuma.
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('VITE_') && value && isPrivileged(value.trim())) {
      throw new AdminEnvGuardError(
        'PRIVILEGED_KEY_EXPOSED',
        `${name} contém uma chave privilegiada (service_role / sb_secret_). ` +
          'Variáveis VITE_* ficam públicas no browser; remova-a imediatamente.',
      );
    }
  }

  // 2. URL do Supabase: obrigatório, nunca produção, exactamente o staging.
  const url = env['VITE_SUPABASE_URL']?.trim() ?? '';
  if (url === '') {
    throw new AdminEnvGuardError('URL_MISSING', `VITE_SUPABASE_URL é obrigatório (esperado ${STAGING_URL}).`);
  }
  if (url.toLowerCase().includes(PRODUCTION_REF)) {
    throw new AdminEnvGuardError(
      'PRODUCTION_BLOCKED',
      'VITE_SUPABASE_URL refere o projecto de produção. Decisão F-04: o Admin Panel usa só o staging até à Fase 3.',
    );
  }
  if (url !== STAGING_URL) {
    throw new AdminEnvGuardError('URL_NOT_STAGING', `VITE_SUPABASE_URL tem de ser exactamente ${STAGING_URL}.`);
  }

  // 3. Chave anon: pública, mas tem de ser do staging (senão o login falha
  //    ou, pior, fala com outro projecto).
  const anonKey = env['VITE_SUPABASE_ANON_KEY']?.trim() ?? '';
  if (anonKey === '') {
    throw new AdminEnvGuardError('ANON_KEY_MISSING', 'VITE_SUPABASE_ANON_KEY é obrigatória.');
  }
  if (!PUBLISHABLE_SHAPE.test(anonKey)) {
    const claims = jwtClaims(anonKey);
    if (claims === null || claims['role'] !== 'anon') {
      throw new AdminEnvGuardError(
        'ANON_KEY_INVALID',
        'VITE_SUPABASE_ANON_KEY não é uma chave pública válida (esperado sb_publishable_... ou JWT anon).',
      );
    }
    if (typeof claims['ref'] === 'string' && claims['ref'].includes(PRODUCTION_REF)) {
      throw new AdminEnvGuardError('PRODUCTION_BLOCKED', 'VITE_SUPABASE_ANON_KEY pertence ao projecto de produção.');
    }
    if (claims['ref'] !== STAGING_REF) {
      throw new AdminEnvGuardError('ANON_KEY_INVALID', 'VITE_SUPABASE_ANON_KEY pertence a outro projecto que não o staging.');
    }
  }

  // 4. Review API: só se valida a forma; o host depende do deploy.
  const apiUrl = env['VITE_API_BASE_URL']?.trim() ?? '';
  if (!/^https?:\/\/[^\s/]+/.test(apiUrl)) {
    throw new AdminEnvGuardError('API_URL_INVALID', 'VITE_API_BASE_URL é obrigatório e tem de ser um URL http(s).');
  }
}
