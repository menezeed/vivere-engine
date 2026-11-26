/**
 * Sessões agendadas (scheduled-sessions) e harvester incremental. Sem rede.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySessionsPage, confirmedFutureBySeries, newState, parseSessionsState, seriesIdFromSuperEvent, SESSIONS_FEED_URL, londonLocal,
} from '../betterSessions';
import { main as harvest, type FetchText } from '../../../../scripts/harvest-better-sessions';
import { BETTER_CONFIG } from '../config';

const SE = (id: string) => `https://better-admin.org.uk/api/openactive/better/session-series/activity_recurrence_group:${id}`;
const session = (id: string, series: string, start: string, o: Record<string, unknown> = {}) => ({
  state: 'updated', kind: 'ScheduledSession', id, modified: 1,
  data: { '@type': 'ScheduledSession', superEvent: SE(series), startDate: start, endDate: start.replace(/T(\d\d)/, (_m, h) => `T${String(Number(h) + 1).padStart(2, '0')}`),
    eventStatus: 'https://schema.org/EventScheduled', remainingAttendeeCapacity: 3, maximumAttendeeCapacity: 20,
    leader: [{ name: 'Jane Smith' }], description: 'free text', ...o },
});

describe('parsing de sessões', () => {
  it('superEvent: URL ou objecto', () => {
    expect(seriesIdFromSuperEvent(SE('34290'))).toBe('34290');
    expect(seriesIdFromSuperEvent({ '@id': SE('1') })).toBe('1');
    expect(seriesIdFromSuperEvent('https://x/other/1')).toBeNull();
  });

  it('guarda só séries de Richmond e só a allowlist; deleted remove', () => {
    const st = newState(['34290']);
    applySessionsPage(st, [session('s1', '34290', '2026-11-30T09:30:00Z'), session('s2', '999', '2026-11-30T09:30:00Z')]);
    expect(Object.keys(st.sessions)).toEqual(['s1']);
    expect(Object.keys(st.sessions['s1']!).sort()).toEqual(['end', 'maximum', 'remaining', 'series_id', 'start', 'status']);
    expect(JSON.stringify(st)).not.toMatch(/Jane|free text/);
    applySessionsPage(st, [{ state: 'deleted', kind: 'ScheduledSession', id: 's1', modified: 2 }]);
    expect(st.sessions).toEqual({});
    expect(st.items_read_total).toBe(3);
  });

  it('futuras confirmadas: hora local (BST/GMT), canceladas fora, passadas fora', () => {
    const st = newState(['1']);
    applySessionsPage(st, [
      session('a', '1', '2026-10-19T08:30:00Z'),   // BST → 09:30 local
      session('b', '1', '2026-10-26T09:30:00Z'),   // GMT → 09:30 local
      session('c', '1', '2026-10-27T09:30:00Z', { eventStatus: 'https://schema.org/EventCancelled' }),
      session('d', '1', '2026-10-01T08:30:00Z'),
    ]);
    const c = confirmedFutureBySeries(st, '2026-10-19').get('1')!;
    expect(c.occurrences.map(o => `${o.date} ${o.time}`)).toEqual(['2026-10-19 09:30', '2026-10-26 09:30']);
    expect(c.cancelled_future).toBe(1);
    expect(londonLocal('2026-07-01T23:30:00Z')).toEqual({ date: '2026-07-02', time: '00:30' });
  });

  it('estado com campo fora da allowlist é recusado', () => {
    const st = newState(['1']);
    applySessionsPage(st, [session('a', '1', '2026-11-30T09:30:00Z')]);
    expect(() => parseSessionsState(st)).not.toThrow();
    const bad = JSON.parse(JSON.stringify(st));
    bad.sessions.a.leader = 'Jane';
    expect(() => parseSessionsState(bad)).toThrow(/inválida/);
  });
});

describe('harvest-better-sessions (fetch falso)', () => {
  const files: string[] = [];
  afterEach(() => { for (const f of files.splice(0)) if (existsSync(f)) unlinkSync(f); });

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'harvest-better-'));
    const snap = join(dir, 'snap.json');
    writeFileSync(snap, JSON.stringify({
      gerado_em: '2026-11-26T12:00:00Z', hoje: '2026-11-26', dry_run: true, escrita_em_bd: false,
      fonte: { source_key: BETTER_CONFIG.source_key, feed_url: BETTER_CONFIG.feed_url, feed_completo: true }, produto: BETTER_CONFIG.product_key,
      series: [{ identifier: '34290', rpde_modified: null, name: 'Swim for 60+', url: null, activities: [], age_range: { min: 60, max: null }, offers: [],
        location: { name: 'Pools on the Park', street: null, locality: null, postcode: 'TW9 2SF' }, schedules: [] }],
    }));
    const state = join(dir, 'state.json');
    files.push(snap, state);
    return { snap, state };
  }

  /** Feed falso de N páginas com 1 sessão cada; depois página vazia com next == url. */
  function feed(n: number) {
    const urls: string[] = [];
    const pageUrl = (i: number) => (i === 0 ? SESSIONS_FEED_URL : `${SESSIONS_FEED_URL}?afterTimestamp=${i}`);
    const fetchText: FetchText = async (url, init) => {
      urls.push(url);
      expect(init.headers['User-Agent']).toBe(BETTER_CONFIG.user_agent);
      const i = url === SESSIONS_FEED_URL ? 0 : Number(new URL(url).searchParams.get('afterTimestamp'));
      const body = i < n
        ? { items: [session(`s${i}`, i % 2 ? '34290' : '777', '2026-12-01T09:30:00Z')], next: pageUrl(i + 1) }
        : { items: [], next: url };
      return { status: 200, text: async () => JSON.stringify(body) };
    };
    return { fetchText, urls };
  }

  it('retoma do cursor guardado e pára no fim do feed; 3 s entre pedidos', async () => {
    const { snap, state } = setup();
    const f = feed(5);
    const sleeps: number[] = [];
    const deps = { fetchText: f.fetchText, sleep: async (ms: number) => { sleeps.push(ms); }, log: () => {} };
    const r1 = await harvest(['n', 'x', `--snapshot=${snap}`, `--state=${state}`, '--max-pages=3'], deps);
    expect(r1.reached_end).toBe(false);
    expect(r1.pages_read_total).toBe(3);
    expect(r1.cursor).toBe(`${SESSIONS_FEED_URL}?afterTimestamp=3`);
    expect(sleeps).toEqual([3000, 3000]);
    const r2 = await harvest(['n', 'x', `--snapshot=${snap}`, `--state=${state}`, '--max-pages=60'], deps);
    expect(f.urls[3]).toBe(`${SESSIONS_FEED_URL}?afterTimestamp=3`); // retomou
    expect(r2.reached_end).toBe(true);
    expect(r2.pages_read_total).toBe(6);
    expect(r2.runs.at(-1)!.stop_reason).toBe('end_of_feed');
    expect(Object.keys(r2.sessions).sort()).toEqual(['s1', 's3']); // só a série de Richmond
    const saved = JSON.parse(readFileSync(state, 'utf8'));
    expect(saved.bytes_total).toBeGreaterThan(0);
    expect(JSON.stringify(saved)).not.toMatch(/Jane|free text|"items"/);
  });

  it('--max-pages tem tecto de 60', async () => {
    const { snap, state } = setup();
    const f = feed(1000);
    const r = await harvest(['n', 'x', `--snapshot=${snap}`, `--state=${state}`, '--max-pages=500'], { fetchText: f.fetchText, sleep: async () => {}, log: () => {} });
    expect(f.urls).toHaveLength(60);
    expect(r.runs[0]!.stop_reason).toBe('max_pages');
  });

  it('pára em 429/403 e regista o estado HTTP', async () => {
    for (const status of [429, 403]) {
      const { snap, state } = setup();
      let n = 0;
      const fetchText: FetchText = async () => (n++ === 0
        ? { status: 200, text: async () => JSON.stringify({ items: [session('a', '34290', '2026-12-01T09:30:00Z')], next: `${SESSIONS_FEED_URL}?afterTimestamp=1` }) }
        : { status, text: async () => '' });
      const r = await harvest(['n', 'x', `--snapshot=${snap}`, `--state=${state}`], { fetchText, sleep: async () => {}, log: () => {} });
      expect(n).toBe(2);
      expect(r.runs[0]!.stop_reason).toBe(`http_${status}`);
      expect(r.runs[0]!.http_statuses).toEqual({ '200': 1, [String(status)]: 1 });
      expect(r.reached_end).toBe(false);
    }
  });
});
