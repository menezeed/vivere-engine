/**
 * E4 — classificação de erros e retry limitado SÓ para erros transitórios.
 *
 * Transitório = vale a pena repetir o MESMO pedido de leitura:
 *   - HTTP 408, 429 e 5xx;
 *   - falhas de rede temporárias (ECONNRESET, ETIMEDOUT, ECONNREFUSED,
 *     EAI_AGAIN, "fetch failed", "socket hang up", timeouts).
 * Tudo o resto (4xx, DNS inexistente, envGuard, erros de persistência,
 * erros de programação) falha logo, sem retry.
 *
 * O retry aplica-se só a WordPressApiClient.fetchPosts (GET, sem efeitos).
 * Nunca se repete uma fonte inteira nem uma escrita em repositórios: uma
 * escrita repetida abriria outro ingestion_run (chave por execução).
 *
 * NOTA: WordPressApiClient já repete internamente as excepções de rede de
 * fetch() (3 tentativas, 1 s/2 s). Este wrapper repete os erros HTTP
 * transitórios (que fetch() não lança) e as falhas de rede que sobrevivem
 * a esse retry interno — no total, limitado e com backoff.
 */
import type { WordPressApiClient, FetchPostsParams, FetchPostsResult } from '../../collectors/wordpress-content/WordPressApiClient';

export type IngestionErrorClass =
  | 'http_transient'
  | 'http_permanent'
  | 'network_transient'
  | 'network_permanent'
  | 'env_guard'
  | 'persistence'
  | 'unknown';

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const PERMANENT_NETWORK_CODES = new Set(['ENOTFOUND', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : '';
}

function codeOf(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const own = (err as { code?: unknown }).code;
  if (typeof own === 'string') return own;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null && typeof (cause as { code?: unknown }).code === 'string') {
    return (cause as { code: string }).code;
  }
  return null;
}

/** Estado HTTP de um erro: propriedade `status` ou mensagem "falhou (503)" / "HTTP 503". */
export function httpStatusOf(err: unknown): number | null {
  if (typeof err === 'object' && err !== null) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isInteger(status)) return status;
  }
  const m = /(?:falhou|HTTP)\s*\(?(\d{3})\)?/i.exec(messageOf(err));
  return m ? Number(m[1]) : null;
}

/** Classifica um erro (objecto ou só a mensagem). Pura. */
export function classifyIngestionError(err: unknown): IngestionErrorClass {
  const message = messageOf(err);
  const name = err instanceof Error ? err.name : '';
  if (name === 'EnvGuardError' || /^\[envGuard:/.test(message)) return 'env_guard';

  const status = httpStatusOf(err);
  if (status !== null) {
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return 'http_transient';
    if (status >= 400 && status <= 499) return 'http_permanent';
  }

  if (/Repository\.|insertBatch|ingestion_runs?\b/.test(message)) return 'persistence';

  const code = codeOf(err);
  if (code && PERMANENT_NETWORK_CODES.has(code)) return 'network_permanent';
  if (code && TRANSIENT_NETWORK_CODES.has(code)) return 'network_transient';
  if (/ENOTFOUND/.test(message)) return 'network_permanent';
  for (const c of TRANSIENT_NETWORK_CODES) if (message.includes(c)) return 'network_transient';
  if (name === 'AbortError' || name === 'TimeoutError' || /fetch failed|socket hang up|network error|timed? ?out/i.test(message)) {
    return 'network_transient';
  }
  return 'unknown';
}

export function isTransient(cls: IngestionErrorClass): boolean {
  return cls === 'http_transient' || cls === 'network_transient';
}

export interface TransientRetryPolicy {
  /** Tentativas totais (inclui a primeira). */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_TRANSIENT_RETRY_POLICY: Readonly<TransientRetryPolicy> = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 2000,
  maxDelayMs: 15000,
});

/** Atraso (ms) antes da tentativa `attempt + 1`. Exponencial, com tecto. */
export function backoffDelayMs(attempt: number, policy: TransientRetryPolicy): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
}

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executa `fn`, repetindo SÓ erros transitórios, até `maxAttempts`.
 * Erros não transitórios são relançados de imediato.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  policy: TransientRetryPolicy = DEFAULT_TRANSIENT_RETRY_POLICY,
  sleep: Sleep = realSleep,
  onRetry?: (info: { attempt: number; delayMs: number; errorClass: IngestionErrorClass }) => void,
): Promise<T> {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) throw new Error('maxAttempts tem de ser um inteiro >= 1');
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const errorClass = classifyIngestionError(err);
      if (!isTransient(errorClass) || attempt >= policy.maxAttempts) throw err;
      const delayMs = backoffDelayMs(attempt, policy);
      onRetry?.({ attempt, delayMs, errorClass });
      await sleep(delayMs);
    }
  }
}

/** Envolve um WordPressApiClient: fetchPosts com retry de erros transitórios. */
export function retryingApiClient(
  inner: WordPressApiClient,
  policy: TransientRetryPolicy = DEFAULT_TRANSIENT_RETRY_POLICY,
  sleep: Sleep = realSleep,
  onRetry?: (info: { attempt: number; delayMs: number; errorClass: IngestionErrorClass }) => void,
): WordPressApiClient {
  return {
    fetchPosts: (params: FetchPostsParams): Promise<FetchPostsResult> =>
      withTransientRetry(() => inner.fetchPosts(params), policy, sleep, onRetry),
  } as unknown as WordPressApiClient;
}
