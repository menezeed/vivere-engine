import { describe, expect, it, vi } from 'vitest';
import { WordPressApiClient, WORDPRESS_REQUEST_TIMEOUT_MS } from '../WordPressApiClient';
import { classifyIngestionError, isTransient } from '../../../ingestion/assisted/transientErrors';

/** fetch que nunca responde: só termina quando o sinal aborta (como um servidor pendurado). */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // sem sinal ficaria pendurado para sempre
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
}

describe('WordPressApiClient — timeout por pedido', () => {
  it('servidor que não responde → falha por timeout em cada tentativa, sem pendurar', async () => {
    const f = hangingFetch();
    const client = new WordPressApiClient('https://exemplo.invalid', {
      timeoutMs: 20, fetchImpl: f as unknown as typeof fetch, retry: { maxAttempts: 2, baseDelayMs: 0 },
    });
    const err = await client.fetchPosts({ categoryId: 73, page: 1, perPage: 20 }).catch((e: unknown) => e);
    expect((err as Error).name).toBe('TimeoutError');
    expect(f).toHaveBeenCalledTimes(2);
    for (const call of f.mock.calls) expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('o erro de timeout é transitório para a execução assistida (repetível)', async () => {
    const client = new WordPressApiClient('https://exemplo.invalid', {
      timeoutMs: 10, fetchImpl: hangingFetch() as unknown as typeof fetch, retry: { maxAttempts: 1, baseDelayMs: 0 },
    });
    const err = await client.fetchPosts({ categoryId: 73, page: 1, perPage: 20 }).catch((e: unknown) => e);
    expect(isTransient(classifyIngestionError(err))).toBe(true);
  });

  it('cada tentativa recebe um sinal novo (o prazo não é partilhado entre repetições)', async () => {
    const f = hangingFetch();
    const client = new WordPressApiClient('https://exemplo.invalid', {
      timeoutMs: 10, fetchImpl: f as unknown as typeof fetch, retry: { maxAttempts: 3, baseDelayMs: 0 },
    });
    await client.fetchPosts({ categoryId: 73, page: 1, perPage: 20 }).catch(() => undefined);
    const signals = f.mock.calls.map((c) => c[1]?.signal);
    expect(new Set(signals).size).toBe(3);
  });

  it('resposta rápida passa normalmente (o timeout não interfere)', async () => {
    const f = vi.fn(async () => new Response('[]', { status: 200, headers: { 'X-WP-TotalPages': '1' } }));
    const client = new WordPressApiClient('https://exemplo.invalid', { timeoutMs: 1000, fetchImpl: f as unknown as typeof fetch });
    await expect(client.fetchPosts({ categoryId: 73, page: 1, perPage: 20 })).resolves.toEqual({ posts: [], totalPages: 1 });
  });

  it('valor por omissão de 30 s e recusa de timeout inválido', () => {
    expect(WORDPRESS_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(() => new WordPressApiClient('https://exemplo.invalid', { timeoutMs: 0 })).toThrow(/positivo/);
    expect(() => new WordPressApiClient('https://exemplo.invalid', { timeoutMs: Number.NaN })).toThrow(/positivo/);
  });
});
