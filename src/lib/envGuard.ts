/**
 * Guarda de ambiente (SEC-O, fase 1).
 *
 * Problema: o Engine, a Review API e o security harness criam o cliente
 * Supabase só a partir de SUPABASE_URL e SUPABASE_SERVICE_KEY. Nada
 * verificava para que projecto apontavam, e a produção não tem backup.
 *
 * Esta guarda é uma função SÍNCRONA, PURA e SEM REDE. Lê só o objecto de
 * ambiente que recebe (por omissão process.env, lido no momento da
 * chamada), não regista nada e nunca inclui valores de chaves nas mensagens.
 *
 * FASE 1 aceita EXCLUSIVAMENTE:
 *   VIVERE_ENV   = staging
 *   SUPABASE_URL = https://jvtcgomwbfojsttepcfc.supabase.co  (exacto)
 * e uma SUPABASE_SERVICE_KEY de formato válido. Qualquer referência à
 * produção é bloqueada, inclusive com VIVERE_ENV=production e a variável
 * VIVERE_PRODUCTION_CONFIRM definida. NODE_ENV nunca é lido.
 *
 * LIMITE ASSUMIDO: uma chave sb_secret_ com formato válido NÃO prova que
 * pertence ao projecto staging (o Supabase não expõe o projecto numa chave
 * nova, e o formato é opaco). Esta fase não o verifica; o resultado di-lo
 * explicitamente (serviceKeyProjectBinding = 'unverified' e warnings).
 *
 * Integrada em getSupabaseClient() (fase 2A) e nos dois scripts que criam
 * clientes directamente (fase 2B): scripts/security-rls-validation.ts e
 * scripts/validate-staging-bootstrap.ts.
 */
import { SUPABASE_PROJECT_REFS, supabaseUrlFor } from '../config/environments';

export const ENV_VAR_NAMES = {
  environment: 'VIVERE_ENV',
  url: 'SUPABASE_URL',
  serviceKey: 'SUPABASE_SERVICE_KEY',
  productionConfirm: 'VIVERE_PRODUCTION_CONFIRM',
} as const;

export type EnvGuardErrorCode =
  | 'ENV_MISSING'
  | 'ENV_INVALID'
  | 'PRODUCTION_BLOCKED'
  | 'CONFLICTING_VARIABLES'
  | 'URL_MISSING'
  | 'URL_INVALID'
  | 'URL_REF_MISMATCH'
  | 'KEY_MISSING'
  | 'KEY_INVALID_FORMAT'
  | 'KEY_NOT_SERVICE_ROLE'
  | 'KEY_PROJECT_MISMATCH';

export class EnvGuardError extends Error {
  readonly code: EnvGuardErrorCode;

  constructor(code: EnvGuardErrorCode, message: string) {
    super(`[envGuard:${code}] ${message}`);
    this.name = 'EnvGuardError';
    this.code = code;
  }
}

export type ServiceKeyFormat = 'sb_secret' | 'legacy_jwt';
export type ServiceKeyProjectBinding = 'unverified' | 'jwt_claim_unsigned';

export interface ServiceKeyClassification {
  readonly format: ServiceKeyFormat;
  readonly projectBinding: ServiceKeyProjectBinding;
  readonly warning: string;
}

export interface EnvGuardResult {
  readonly environment: 'staging';
  readonly projectRef: string;
  readonly supabaseUrl: string;
  readonly serviceKeyFormat: ServiceKeyFormat;
  readonly serviceKeyProjectBinding: ServiceKeyProjectBinding;
  readonly warnings: readonly string[];
}

export const SB_SECRET_UNVERIFIED_WARNING =
  'SUPABASE_SERVICE_KEY tem formato sb_secret_ válido, mas isto NÃO comprova que a chave ' +
  'pertence ao projecto staging: o Supabase não expõe o projecto numa chave nova e esta ' +
  'fase não faz verificação online.';

export const LEGACY_JWT_UNSIGNED_WARNING =
  'O claim ref do JWT legado foi lido SEM verificar a assinatura: não é prova criptográfica ' +
  'de que a chave pertence ao projecto staging.';

const STAGING_REF = SUPABASE_PROJECT_REFS.staging;
const PRODUCTION_REF = SUPABASE_PROJECT_REFS.production;

const URL_SHAPE = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;
const SB_SECRET_SHAPE = /^sb_secret_[A-Za-z0-9_-]{16,}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const KNOWN_ROLES: ReadonlySet<string> = new Set(['anon', 'authenticated', 'service_role', 'supabase_admin']);

function mentionsProduction(value: string): boolean {
  return value.toLowerCase().includes(PRODUCTION_REF);
}

function productionBlocked(detail: string): EnvGuardError {
  return new EnvGuardError(
    'PRODUCTION_BLOCKED',
    `Produção está bloqueada nesta fase (${detail}). Use VIVERE_ENV=staging e o ` +
      `SUPABASE_URL do staging. A variável ${ENV_VAR_NAMES.productionConfirm} não desbloqueia a produção.`,
  );
}

function classifyLegacyJwt(raw: string): ServiceKeyClassification {
  const parts = raw.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0 || !BASE64URL.test(p))) {
    throw new EnvGuardError('KEY_INVALID_FORMAT', 'SUPABASE_SERVICE_KEY: JWT com estrutura inválida.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    throw new EnvGuardError('KEY_INVALID_FORMAT', 'SUPABASE_SERVICE_KEY: payload do JWT ilegível.');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new EnvGuardError('KEY_INVALID_FORMAT', 'SUPABASE_SERVICE_KEY: payload do JWT inválido.');
  }

  const claims = payload as Record<string, unknown>;
  const ref = claims['ref'];
  const role = claims['role'];

  if (typeof ref !== 'string' || ref.length === 0) {
    throw new EnvGuardError(
      'KEY_INVALID_FORMAT',
      'SUPABASE_SERVICE_KEY: o JWT não tem claim ref, por isso não se consegue associá-lo a um projecto.',
    );
  }
  if (mentionsProduction(ref)) {
    throw productionBlocked('a chave JWT refere o projecto de produção');
  }
  if (typeof role !== 'string') {
    throw new EnvGuardError('KEY_INVALID_FORMAT', 'SUPABASE_SERVICE_KEY: o JWT não tem claim role.');
  }
  if (role !== 'service_role') {
    const shown = KNOWN_ROLES.has(role) ? role : 'desconhecido';
    throw new EnvGuardError(
      'KEY_NOT_SERVICE_ROLE',
      `SUPABASE_SERVICE_KEY: o JWT tem role "${shown}"; é exigido service_role.`,
    );
  }
  if (ref !== STAGING_REF) {
    throw new EnvGuardError('KEY_PROJECT_MISMATCH', 'SUPABASE_SERVICE_KEY: o JWT pertence a outro projecto que não o staging.');
  }

  return { format: 'legacy_jwt', projectBinding: 'jwt_claim_unsigned', warning: LEGACY_JWT_UNSIGNED_WARNING };
}

/**
 * Valida o FORMATO de uma service key sem registar nem devolver o seu
 * conteúdo. Aceita sb_secret_ (sem provar o projecto) e JWT legado com
 * role service_role e ref do staging. Rejeita tudo o resto.
 */
export function classifyServiceKey(raw: string): ServiceKeyClassification {
  if (raw.length === 0 || raw !== raw.trim() || /\s/.test(raw)) {
    throw new EnvGuardError('KEY_INVALID_FORMAT', 'SUPABASE_SERVICE_KEY: vazia ou com espaços/quebras de linha.');
  }
  if (raw.startsWith('sb_publishable_')) {
    throw new EnvGuardError(
      'KEY_NOT_SERVICE_ROLE',
      'SUPABASE_SERVICE_KEY: é uma chave publishable (pública), não uma chave de servidor.',
    );
  }
  if (raw.startsWith('sb_secret_')) {
    if (!SB_SECRET_SHAPE.test(raw)) {
      throw new EnvGuardError('KEY_INVALID_FORMAT', 'SUPABASE_SERVICE_KEY: prefixo sb_secret_ com resto de formato inválido.');
    }
    return { format: 'sb_secret', projectBinding: 'unverified', warning: SB_SECRET_UNVERIFIED_WARNING };
  }
  if (raw.startsWith('eyJ')) {
    return classifyLegacyJwt(raw);
  }
  throw new EnvGuardError(
    'KEY_INVALID_FORMAT',
    'SUPABASE_SERVICE_KEY: formato não reconhecido (esperado sb_secret_... ou JWT legado service_role).',
  );
}

/**
 * Falha (lança EnvGuardError) se o ambiente não for exactamente o staging
 * declarado. Corre antes de qualquer cliente ou pedido de rede.
 */
export function assertEnvironment(env: NodeJS.ProcessEnv = process.env): EnvGuardResult {
  const rawEnvironment = env[ENV_VAR_NAMES.environment];
  const rawUrl = env[ENV_VAR_NAMES.url];
  const rawKey = env[ENV_VAR_NAMES.serviceKey];
  const rawConfirm = env[ENV_VAR_NAMES.productionConfirm];

  // 1. Ambiente declarado: obrigatório, sem valor por omissão.
  if (rawEnvironment === undefined || rawEnvironment === '') {
    throw new EnvGuardError('ENV_MISSING', `${ENV_VAR_NAMES.environment} é obrigatório (nesta fase, apenas "staging").`);
  }
  if (rawEnvironment.trim().toLowerCase() === 'production') {
    throw productionBlocked(`${ENV_VAR_NAMES.environment}=production`);
  }
  if (rawEnvironment !== 'staging') {
    throw new EnvGuardError(
      'ENV_INVALID',
      `${ENV_VAR_NAMES.environment} tem um valor inválido; nesta fase só "staging" é aceite.`,
    );
  }

  // 2. Variável de confirmação de produção com staging declarado: conflito.
  if (rawConfirm !== undefined && rawConfirm !== '') {
    throw new EnvGuardError(
      'CONFLICTING_VARIABLES',
      `${ENV_VAR_NAMES.productionConfirm} está definida mas ${ENV_VAR_NAMES.environment}=staging. Remova-a.`,
    );
  }

  // 3. URL: obrigatório, nunca produção, e exactamente o do staging.
  if (rawUrl === undefined || rawUrl === '') {
    throw new EnvGuardError('URL_MISSING', `${ENV_VAR_NAMES.url} é obrigatório.`);
  }
  if (mentionsProduction(rawUrl)) {
    throw productionBlocked(`${ENV_VAR_NAMES.url} refere o projecto de produção`);
  }
  const shape = URL_SHAPE.exec(rawUrl);
  if (shape === null) {
    throw new EnvGuardError(
      'URL_INVALID',
      `${ENV_VAR_NAMES.url} tem formato inválido; esperado exactamente ${supabaseUrlFor('staging')} (sem barra final, porta, caminho ou credenciais).`,
    );
  }
  const urlRef = shape[1] ?? '';
  if (urlRef !== STAGING_REF) {
    throw new EnvGuardError(
      'URL_REF_MISMATCH',
      `O ref do ${ENV_VAR_NAMES.url} (${urlRef}) não é o do staging (${STAGING_REF}).`,
    );
  }

  // 4. Chave: formato (nunca o conteúdo).
  if (rawKey === undefined || rawKey === '') {
    throw new EnvGuardError('KEY_MISSING', `${ENV_VAR_NAMES.serviceKey} é obrigatória.`);
  }
  const key = classifyServiceKey(rawKey);

  return {
    environment: 'staging',
    projectRef: STAGING_REF,
    supabaseUrl: supabaseUrlFor('staging'),
    serviceKeyFormat: key.format,
    serviceKeyProjectBinding: key.projectBinding,
    warnings: [key.warning],
  };
}
