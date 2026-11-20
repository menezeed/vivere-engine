import { describe, it, expect, vi } from 'vitest';
import {
  classifyIngestionError,
  isTransient,
  withTransientRetry,
  retryingApiClient,
  backoffDelayMs,
  httpStatusOf,
  DEFAULT_TRANSIENT_RETRY_POLICY,
} from '../transientErrors';
import { EnvGuardError } from '../../../lib/envGuard';
import type { WordPressApiClient } from '../../../collectors/wordpress-content/WordPressApiClient';

function codeError(message: string, code: string, viaCause = false): Error {
  const e = new Error(message) as Error & { code?: string; cause?: unknown };
  if (viaCause) e.cause = { code };
  else e.code = code;
  return e;
}

describe('classifyIngestionError', () => {
  it.each([
    ['WordPress REST API falhou (503) em https://exemplo.gov.br/wp-json: erro', 'http_transient'],
    ['WordPress REST API falhou (502)', 'http_transient'],
    ['WordPress REST API falhou (429)', 'http_transient'],
    ['WordPress REST API falhou (408)', 'http_transient'],
    ['WordPress REST API falhou (404) em https://exemplo.gov.br', 'http_permanent'],
    ['WordPress REST API falhou (403)', 'http_permanent'],
    ['RawActivityItemRepository.insertBatch: violates constraint', 'persistence'],
    ['fetch failed', 'network_transient'],
    ['request timed out', 'network_transient'],
    ['getaddrinfo ENOTFOUND exemplo.gov.br', 'network_permanent'],
    ['TypeError: x is undefined', 'unknown'],
  ] as const)('%s → %s', (message, expected) => {
    expect(classifyIngestionError(new Error(message))).toBe(expected);
  });

  it('usa a propriedade status e os códigos de rede (directos ou em cause)', () => {
    expect(classifyIngestionError(Object.assign(new Error('x'), { status: 500 }))).toBe('http_transient');
    expect(classifyIngestionError(Object.assign(new Error('x'), { status: 400 }))).toBe('http_permanent');
    expect(classifyIngestionError(codeError('fetch failed', 'ECONNRESET', true))).toBe('network_transient');
    expect(classifyIngestionError(codeError('falha', 'ETIMEDOUT'))).toBe('network_transient');
    expect(classifyIngestionError(codeError('fetch failed', 'ENOTFOUND', true))).toBe('network_permanent');
  });

  it('EnvGuardError nunca é transitório', () => {
    const err = new EnvGuardError('PRODUCTION_BLOCKED', 'bloqueado');
    expect(classifyIngestionError(err)).toBe('env_guard');
    expect(isTransient(classifyIngestionError(err))).toBe(false);
  });

  it('httpStatusOf lê a mensagem do WordPressApiClient', () => {
    expect(httpStatusOf(new Error('WordPress REST API falhou (503) em x'))).toBe(503);
    expect(httpStatusOf(new Error('sem estado'))).toBeNull();
  });
});

describe('withTransientRetry', () => {
  const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 150 };

  it('repete 5xx com backoff exponencial limitado e devolve o sucesso', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('WordPress REST API falhou (503)'))
      .mockRejectedValueOnce(new Error('WordPress REST API falhou (429)'))
      .mockResolvedValueOnce('ok');
    await expect(withTransientRetry(fn, policy, sleep)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 150]);
  });

  it('pára em maxAttempts e relança o último erro', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const fn = vi.fn(async () => {
      throw new Error('WordPress REST API falhou (500)');
    });
    await expect(withTransientRetry(fn, policy, sleep)).rejects.toThrow('(500)');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it.each([['WordPress REST API falhou (404)'], ['RawActivityItemRepository.insertBatch: erro'], ['bug']])('não repete erros não transitórios: %s', async (msg) => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const fn = vi.fn(async () => {
      throw new Error(msg);
    });
    await expect(withTransientRetry(fn, policy, sleep)).rejects.toThrow(msg);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('política por omissão: 3 tentativas, 2 s → 4 s, tecto 15 s', () => {
    expect(DEFAULT_TRANSIENT_RETRY_POLICY.maxAttempts).toBe(3);
    expect([1, 2, 3, 4, 5].map((a) => backoffDelayMs(a, DEFAULT_TRANSIENT_RETRY_POLICY))).toEqual([2000, 4000, 8000, 15000, 15000]);
  });

  it('retryingApiClient repete só fetchPosts e notifica cada retry', async () => {
    const inner = {
      fetchPosts: vi
        .fn()
        .mockRejectedValueOnce(new Error('WordPress REST API falhou (502)'))
        .mockResolvedValueOnce({ posts: [], totalPages: 1 }),
    } as unknown as WordPressApiClient;
    const onRetry = vi.fn();
    const client = retryingApiClient(inner, policy, async () => undefined, onRetry);
    await expect(client.fetchPosts({ categoryId: 1, page: 1, perPage: 10 })).resolves.toEqual({ posts: [], totalPages: 1 });
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, delayMs: 100, errorClass: 'http_transient' });
  });
});
