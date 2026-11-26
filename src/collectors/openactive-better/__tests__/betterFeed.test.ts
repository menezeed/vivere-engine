/**
 * Leitura RPDE limitada e validação do snapshot. fetch falso, sem rede.
 */
import { describe, it, expect } from 'vitest';
import { readFeed, parseBetterSnapshot, type FetchJson } from '../betterFeed';
import { BETTER_CONFIG } from '../config';
import type { BetterSeries } from '../betterSeries';

const page = (ids: string[], next: string, postcode = 'TW9 2SF') => ({
  next,
  items: ids.map(id => ({
    state: 'updated', kind: 'SessionSeries', id, modified: 1,
    data: { identifier: id, name: `S ${id}`, location: { name: 'Pools on the Park', address: { postalCode: postcode } }, eventSchedule: [] },
  })),
});

function fakeFetch(pages: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; ua: string }> = [];
  const fn: FetchJson = async (url, init) => {
    const p = pages[calls.length] ?? { body: { items: [], next: url } };
    calls.push({ url, ua: init.headers['User-Agent']! });
    return { status: p.status ?? 200, json: async () => p.body };
  };
  return { fn, calls };
}

describe('readFeed', () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => { sleeps.push(ms); };

  it('segue next até itens vazios; 3 s entre pedidos; UA identificado; só Richmond', async () => {
    sleeps.length = 0;
    const u = BETTER_CONFIG.feed_url;
    const { fn, calls } = fakeFetch([
      { body: page(['1', '2'], `${u}?afterTimestamp=1&afterId=2`) },
      { body: page(['3'], `${u}?afterTimestamp=1&afterId=3`, 'M1 1AA') },
      { body: { items: [], next: `${u}?afterTimestamp=1&afterId=3` } },
    ]);
    const r = await readFeed({ fetchJson: fn, sleep });
    expect(r.requests).toBe(3);
    expect(r.complete).toBe(true);
    expect(r.series.map(s => s.identifier)).toEqual(['1', '2']);
    expect(r.items_read).toBe(3);
    expect(sleeps).toEqual([3000, 3000]);
    expect(calls.every(c => c.ua === 'VivereEngine/1.0 (OpenActive; read-only)')).toBe(true);
  });

  it('nunca passa de 8 pedidos (feed incompleto)', async () => {
    const u = BETTER_CONFIG.feed_url;
    const { fn, calls } = fakeFetch(Array.from({ length: 20 }, (_, i) => ({ body: page([String(i)], `${u}?p=${i + 1}`) })));
    const r = await readFeed({ fetchJson: fn, sleep, maxRequests: 50, intervalMs: 0 });
    expect(calls).toHaveLength(8);
    expect(r.complete).toBe(false);
    expect(r.stop_reason).toBe('request_limit');
  });

  it('pára em 429 e em 403', async () => {
    for (const status of [429, 403]) {
      const { fn, calls } = fakeFetch([{ body: page(['1'], `${BETTER_CONFIG.feed_url}?p=1`) }, { status, body: {} }, { body: page(['2'], 'x') }]);
      const r = await readFeed({ fetchJson: fn, sleep });
      expect(calls).toHaveLength(2);
      expect(r.stop_reason).toBe(`http_${status}`);
      expect(r.complete).toBe(false);
    }
  });

  it('next para outro host: pára', async () => {
    const { fn } = fakeFetch([{ body: page(['1'], 'https://evil.example/feed') }]);
    expect((await readFeed({ fetchJson: fn, sleep })).stop_reason).toBe('foreign_next_url');
  });
});

describe('parseBetterSnapshot', () => {
  const s: BetterSeries = {
    identifier: '1', rpde_modified: null, name: 'Swim for 60+', url: null, activities: ['Swimming'], age_range: { min: 60, max: null },
    offers: [], location: { name: 'Pools on the Park', street: null, locality: 'Richmond', postcode: 'TW9 2SF' },
    schedules: [{ by_day: ['monday'], start_time: '09:30', end_time: '10:25', repeat_frequency: 'P1W', start_date: null, end_date: null, except_dates: [], timezone: 'Europe/London' }],
  };
  const snap = (series: unknown[]) => ({
    gerado_em: '2026-11-26T12:00:00Z', hoje: '2026-11-26', dry_run: true, escrita_em_bd: false,
    fonte: { source_key: BETTER_CONFIG.source_key, feed_url: BETTER_CONFIG.feed_url, feed_completo: true },
    produto: BETTER_CONFIG.product_key, series,
  });

  it('aceita o snapshot válido', () => {
    expect(parseBetterSnapshot(snap([s])).series).toHaveLength(1);
  });

  it('recusa campos fora da allowlist (ex.: description) e telefone', () => {
    expect(() => parseBetterSnapshot(snap([{ ...s, description: 'x' }]))).toThrow(/allowlist/);
    expect(() => parseBetterSnapshot(snap([{ ...s, name: 'Call 020 8123 4567' }]))).toThrow(/dados pessoais/);
  });

  it('recusa séries fora de Richmond e outra fonte', () => {
    expect(() => parseBetterSnapshot(snap([{ ...s, location: { ...s.location, postcode: 'M1 1AA' } }]))).toThrow(/Richmond/);
    expect(() => parseBetterSnapshot({ ...snap([s]), fonte: { source_key: 'outra', feed_url: BETTER_CONFIG.feed_url, feed_completo: true } })).toThrow(/fonte/);
  });
});
