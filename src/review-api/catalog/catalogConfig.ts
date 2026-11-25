/**
 * Catálogo de produção (Issue #52, Fase 1): configuração com FALHA FECHADA.
 *
 * Modos (CATALOG_MODE):
 *   - disabled             (omissão): nenhuma rota de catálogo responde com dados.
 *   - fixture                       : dados SINTÉTICOS em memória (desenvolvimento e testes).
 *   - production-readonly           : leitura da produção via PostgREST com a chave
 *                                     PUBLISHABLE/anon (a mesma que a app pública usa).
 *
 * Regras do modo production-readonly (todas obrigatórias):
 *   - CATALOG_PROD_URL é exactamente https://<ref de produção>.supabase.co;
 *   - CATALOG_PROD_PUBLISHABLE_KEY é sb_publishable_… ou um JWT legado com
 *     role=anon e ref de produção; sb_secret_, service_role e chaves do
 *     staging são recusadas (o catálogo não pode ter privilégios);
 *   - CATALOG_PROD_READONLY_ACK = "PRODUÇÃO — SOMENTE LEITURA" (aceite explícito).
 *
 * Isolamento: este módulo não usa SUPABASE_URL / SUPABASE_SERVICE_KEY nem
 * getSupabaseClient() (fila de staging, guardado por envGuard). O envGuard
 * não é alterado. Nenhuma mensagem inclui valores de chaves.
 */
import { SUPABASE_PROJECT_REFS, supabaseUrlFor } from '../../config/environments';
import { CATALOG_ACCESS_LABEL } from './catalogTypes';

export const CATALOG_VARS = {
  mode: 'CATALOG_MODE',
  url: 'CATALOG_PROD_URL',
  key: 'CATALOG_PROD_PUBLISHABLE_KEY',
  ack: 'CATALOG_PROD_READONLY_ACK',
} as const;

export type CatalogMode = 'disabled' | 'fixture' | 'production-readonly';

export type CatalogConfig =
  | { mode: 'disabled' }
  | { mode: 'fixture' }
  | { mode: 'production-readonly'; baseUrl: string; publishableKey: string; label: typeof CATALOG_ACCESS_LABEL };

export class CatalogConfigError extends Error {
  constructor(message: string) {
    super(`[catalogConfig] ${message}`);
    this.name = 'CatalogConfigError';
  }
}

const B64URL = /^[A-Za-z0-9_-]+$/;
const PUBLISHABLE_SHAPE = /^sb_publishable_[A-Za-z0-9_-]{16,}$/;

function assertPublishableKey(raw: string): void {
  if (raw !== raw.trim() || /\s/.test(raw)) throw new CatalogConfigError(`${CATALOG_VARS.key} tem espaços ou quebras de linha.`);
  if (raw.startsWith('sb_secret_')) {
    throw new CatalogConfigError(`${CATALOG_VARS.key} é uma chave SECRETA; o catálogo só aceita a chave publishable/anon.`);
  }
  if (raw.startsWith('sb_publishable_')) {
    if (!PUBLISHABLE_SHAPE.test(raw)) throw new CatalogConfigError(`${CATALOG_VARS.key}: formato sb_publishable_ inválido.`);
    return;
  }
  const parts = raw.split('.');
  if (!raw.startsWith('eyJ') || parts.length !== 3 || parts.some((p) => p.length === 0 || !B64URL.test(p))) {
    throw new CatalogConfigError(`${CATALOG_VARS.key}: formato não reconhecido (esperado sb_publishable_… ou JWT anon).`);
  }
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new CatalogConfigError(`${CATALOG_VARS.key}: payload do JWT ilegível.`);
  }
  if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new CatalogConfigError(`${CATALOG_VARS.key}: payload do JWT inválido.`);
  }
  if (claims['role'] !== 'anon') {
    throw new CatalogConfigError(`${CATALOG_VARS.key}: o JWT não tem role "anon"; chaves privilegiadas são recusadas.`);
  }
  if (claims['ref'] !== SUPABASE_PROJECT_REFS.production) {
    throw new CatalogConfigError(`${CATALOG_VARS.key}: o JWT não pertence ao projecto de produção.`);
  }
}

export function resolveCatalogConfig(env: NodeJS.ProcessEnv): CatalogConfig {
  const mode = env[CATALOG_VARS.mode];
  if (mode === undefined || mode === '' || mode === 'disabled') return { mode: 'disabled' };
  if (mode === 'fixture') return { mode: 'fixture' };
  if (mode !== 'production-readonly') {
    throw new CatalogConfigError(`${CATALOG_VARS.mode} inválido; aceites: disabled, fixture, production-readonly.`);
  }

  const url = env[CATALOG_VARS.url];
  const key = env[CATALOG_VARS.key];
  const ack = env[CATALOG_VARS.ack];
  const expectedUrl = supabaseUrlFor('production');

  if (!url) throw new CatalogConfigError(`${CATALOG_VARS.url} é obrigatório no modo production-readonly.`);
  if (url.toLowerCase().includes(SUPABASE_PROJECT_REFS.staging)) {
    throw new CatalogConfigError(`${CATALOG_VARS.url} aponta para o staging; o catálogo de produção nunca usa o staging.`);
  }
  if (url !== expectedUrl) throw new CatalogConfigError(`${CATALOG_VARS.url} tem de ser exactamente ${expectedUrl}.`);
  if (!key) throw new CatalogConfigError(`${CATALOG_VARS.key} é obrigatória no modo production-readonly.`);
  assertPublishableKey(key);
  if (ack !== CATALOG_ACCESS_LABEL) {
    throw new CatalogConfigError(`${CATALOG_VARS.ack} tem de ser exactamente "${CATALOG_ACCESS_LABEL}".`);
  }
  return { mode: 'production-readonly', baseUrl: expectedUrl, publishableKey: key, label: CATALOG_ACCESS_LABEL };
}
