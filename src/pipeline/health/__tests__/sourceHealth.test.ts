import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  evaluateSourceHealth,
  formatSourceHealthSummary,
  DEFAULT_SOURCE_HEALTH_THRESHOLDS,
  type SourceRunInfo,
} from '../sourceHealth';
import { computeRunQualityMetrics, type RunQualityReport } from '../../metrics/runQualityMetrics';
import { WordPressContentCollector } from '../../../collectors/wordpress-content/WordPressContentCollector';
import type { WordPressApiClient, WordPressPost, FetchPostsResult } from '../../../collectors/wordpress-content/WordPressApiClient';
import { AVAILABLE_INSTANCES } from '../../../collectors/wordpress-content/config/registry';
import { parseWordPressGmtDate } from '../../../lib/wordpressDates';
import type { RawActivityItem } from '../../../types/RawActivityItem';

const NOW = '2026-11-14T12:00:00.000Z';
const INSTANCES = ['cabo-frio', 'sao-pedro-da-aldeia', 'rio-das-ostras', 'buzios'] as const;

function loadPosts(instance: string): WordPressPost[] {
  const url = new URL(`../../../collectors/wordpress-content/__tests__/fixtures/${instance}.posts.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as WordPressPost[];
}

function fakeApiClient(posts: WordPressPost[]): WordPressApiClient {
  return { fetchPosts: vi.fn(async (): Promise<FetchPostsResult> => ({ posts, totalPages: 1 })) } as unknown as WordPressApiClient;
}

/** Mesmo encadeamento do L7 (fixtures → collector real → L4), sem BD. */
async function fixtureRun(skip: readonly string[] = []): Promise<{ report: RunQualityReport; lastPublishedAt: Record<string, string> }> {
  const items: RawActivityItem[] = [];
  const lastPublishedAt: Record<string, string> = {};
  for (const instance of INSTANCES) {
    const config = AVAILABLE_INSTANCES[instance]!;
    const posts = skip.includes(instance) ? [] : loadPosts(instance);
    const result = await new WordPressContentCollector(fakeApiClient(posts), config).collect({ sinceDays: 200 });
    items.push(...result.items);
    for (const p of loadPosts(instance)) {
      const iso = parseWordPressGmtDate(p.date_gmt).toISOString();
      if (!lastPublishedAt[config.source_key] || iso > lastPublishedAt[config.source_key]!) lastPublishedAt[config.source_key] = iso;
    }
  }
  return { report: computeRunQualityMetrics(items, { runId: 'e7-fixtures', generatedAt: NOW }), lastPublishedAt };
}

function syntheticReport(counts: Record<string, { total: number; withDate: number }>, runId = 'sint'): RunQualityReport {
  const items: RawActivityItem[] = [];
  for (const [sourceKey, { total, withDate }] of Object.entries(counts)) {
    for (let n = 0; n < total; n++) {
      items.push({
        source_key: sourceKey,
        source_item_id: `${n}`,
        collected_at: NOW,
        title: 'x',
        description: null,
        raw_category_text: null,
        occurrences: n < withDate ? [{ date: '2026-11-20', time: null, end_date: null, end_time: null }] : [],
        recurrence_text_hint: null,
        venue_mention: null,
        price_text: null,
        is_free_hint: null,
        image_url: null,
        external_url: null,
        contact_phone: null,
        contact_email: null,
        language: 'pt',
        raw_payload: {},
      });
    }
  }
  return computeRunQualityMetrics(items, { runId, generatedAt: NOW, resolveCity: () => null });
}

describe('evaluateSourceHealth — relatório L4 gerado pelas fixtures', () => {
  let full: Awaited<ReturnType<typeof fixtureRun>>;
  let withoutCaboFrio: Awaited<ReturnType<typeof fixtureRun>>;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    full = await fixtureRun();
    withoutCaboFrio = await fixtureRun(['cabo-frio']);
  });
  afterAll(() => vi.useRealTimers());

  it('datas sem ano (Rio das Ostras, São Pedro) → high_no_date_rate; Cabo Frio e Búzios sem alerta de qualidade', () => {
    const health = evaluateSourceHealth({ current: full.report, now: NOW });
    expect(health.alerts.map((a) => [a.source_key, a.code])).toEqual([
      ['prefeitura_rio_das_ostras', 'high_no_date_rate'],
      ['prefeitura_sao_pedro_da_aldeia', 'high_no_date_rate'],
    ]);
    expect(health.alerts[0]!.data).toMatchObject({ items: 2, items_without_date: 2, no_date_pct: 100 });
    expect(health.status).toBe('warning');
    expect(health.notes).toEqual([
      'sem relatório anterior: queda de volume não avaliada',
      'sem data do último post: frescura não avaliada',
    ]);
  });

  it('frescura com a data do último post das fixtures (14 dias): só Rio das Ostras está fresca', () => {
    const health = evaluateSourceHealth({ current: full.report, lastPublishedAt: full.lastPublishedAt, now: NOW });
    const stale = health.alerts.filter((a) => a.code === 'stale_source');
    expect(stale.map((a) => [a.source_key, a.data['days_since']])).toEqual([
      ['prefeitura_buzios', 17],
      ['prefeitura_cabo_frio', 141],
      ['prefeitura_sao_pedro_da_aldeia', 154],
    ]);
    expect(stale[0]!.data['last_published_at']).toBe('2026-10-27T16:52:47.000Z');
  });

  it('fonte que deixa de devolver itens face à execução anterior → zero_items (critical)', () => {
    const health = evaluateSourceHealth({ current: withoutCaboFrio.report, previous: full.report, now: NOW });
    const cf = health.sources.find((s) => s.source_key === 'prefeitura_cabo_frio')!;
    expect(cf).toMatchObject({ status: 'critical', total_items: 0, city: 'Cabo Frio' });
    expect(cf.alerts).toEqual([
      expect.objectContaining({ code: 'zero_items', severity: 'critical', data: { previous_items: 3 } }),
    ]);
    expect(health.status).toBe('critical');
    expect(health.alerts[0]!.code).toBe('zero_items'); // critical primeiro
  });

  it('JSON serializável e resumo legível', () => {
    const health = evaluateSourceHealth({ current: withoutCaboFrio.report, previous: full.report, lastPublishedAt: full.lastPublishedAt, now: NOW });
    expect(JSON.parse(JSON.stringify(health))).toEqual(health);
    const summary = formatSourceHealthSummary(health);
    expect(summary).toContain('Saúde das fontes — execução e7-fixtures');
    expect(summary).toContain('CRÍTICO prefeitura_cabo_frio (Cabo Frio): 0 itens');
    expect(summary).toContain('[zero_items]');
    expect(summary).toContain('AVISO prefeitura_rio_das_ostras (Rio das Ostras): 2 itens');
    expect(summary).toContain('  - [high_no_date_rate] 100% dos itens sem data');
  });
});

describe('evaluateSourceHealth — casos-limite', () => {
  it('fonte esperada sem nenhum item e sem histórico → zero_items com previous_items null', () => {
    const h = evaluateSourceHealth({ current: syntheticReport({}), expectedSources: ['fonte_a'], now: NOW });
    expect(h.sources).toEqual([
      { source_key: 'fonte_a', city: null, status: 'critical', total_items: 0, alerts: [expect.objectContaining({ code: 'zero_items', data: { previous_items: null } })] },
    ]);
  });

  it('volume_drop: > 50% gera aviso; exactamente 50% não; anterior abaixo do mínimo não é avaliado', () => {
    const prev = syntheticReport({ a: { total: 10, withDate: 10 }, b: { total: 10, withDate: 10 }, c: { total: 3, withDate: 3 } });
    const cur = syntheticReport({ a: { total: 4, withDate: 4 }, b: { total: 5, withDate: 5 }, c: { total: 1, withDate: 1 } });
    const h = evaluateSourceHealth({ current: cur, previous: prev, now: NOW });
    expect(h.alerts.map((x) => [x.source_key, x.code, x.data['drop_pct']])).toEqual([['a', 'volume_drop', 60]]);
  });

  it('limiares configuráveis substituem os defaults (e ficam no relatório)', () => {
    const prev = syntheticReport({ a: { total: 10, withDate: 10 } });
    const cur = syntheticReport({ a: { total: 8, withDate: 8 } });
    const h = evaluateSourceHealth({ current: cur, previous: prev, now: NOW, thresholds: { dropPct: 10 } });
    expect(h.alerts.map((x) => x.code)).toEqual(['volume_drop']);
    expect(h.thresholds).toEqual({ ...DEFAULT_SOURCE_HEALTH_THRESHOLDS, dropPct: 10 });
  });

  it('high_no_date_rate: respeita o mínimo de itens e o limiar (50% exacto não alerta)', () => {
    const cur = syntheticReport({ um: { total: 1, withDate: 0 }, metade: { total: 4, withDate: 2 }, maioria: { total: 4, withDate: 1 } });
    const h = evaluateSourceHealth({ current: cur, now: NOW });
    expect(h.alerts.map((x) => [x.source_key, x.code, x.data['no_date_pct']])).toEqual([['maioria', 'high_no_date_rate', 75]]);
  });

  it('high_no_date_rate decide pelos counts, não pela % arredondada do L4 (revisão r0)', () => {
    // 1001/2001 = 50,025% > 50 → alerta (o L4 arredonda para 50,0%).
    // 1000/2001 = 49,975% < 50 → sem alerta (o L4 arredonda para 50,0%).
    // 1000/2000 = 50% exacto → sem alerta.
    const cur = syntheticReport({
      acima: { total: 2001, withDate: 1000 },
      abaixo: { total: 2001, withDate: 1001 },
      exacto: { total: 2000, withDate: 1000 },
    });
    expect(cur.by_group.map((g) => g.with_date.pct)).toEqual([50, 50, 50]); // premissa: todos arredondam para 50
    const h = evaluateSourceHealth({ current: cur, now: NOW });
    expect(h.alerts.map((x) => [x.source_key, x.code, x.data['items_without_date']])).toEqual([['acima', 'high_no_date_rate', 1001]]);
    expect(h.alerts[0]!.data['no_date_pct']).toBe(50); // só a mensagem/dado é arredondado
  });

  it('volume_drop decide pelos counts: imediatamente acima e abaixo de 50% com volumes grandes', () => {
    const prev = syntheticReport({ acima: { total: 2001, withDate: 2001 }, abaixo: { total: 2001, withDate: 2001 } });
    // acima: 2001 → 1000 = queda 50,025%; abaixo: 2001 → 1001 = queda 49,975%
    const cur = syntheticReport({ acima: { total: 1000, withDate: 1000 }, abaixo: { total: 1001, withDate: 1001 } });
    const h = evaluateSourceHealth({ current: cur, previous: prev, now: NOW });
    expect(h.alerts.map((x) => [x.source_key, x.code])).toEqual([['acima', 'volume_drop']]);
  });

  it('run_open e stale_source decidem pelo valor exacto, não arredondado', () => {
    const runs: SourceRunInfo[] = [
      { source_key: 'acima', status: 'running', started_at: '2026-11-14T05:59:59.000Z', finished_at: null }, // 6h00m01s
      { source_key: 'abaixo', status: 'running', started_at: '2026-11-14T06:00:01.000Z', finished_at: null }, // 5h59m59s
    ];
    const cur = syntheticReport({ acima: { total: 1, withDate: 1 }, abaixo: { total: 1, withDate: 1 } });
    const h = evaluateSourceHealth({
      current: cur,
      runs,
      lastPublishedAt: { acima: '2026-10-31T11:59:59.000Z', abaixo: '2026-10-31T12:00:01.000Z' }, // 14 dias ± 1 s
      now: NOW,
    });
    expect(h.alerts.map((x) => [x.source_key, x.code])).toEqual([
      ['acima', 'run_open'],
      ['acima', 'stale_source'],
    ]);
  });

  it('execuções: failed → critical com mensagem; partial → warning; running antiga → run_open; running recente e success → nada', () => {
    const runs: SourceRunInfo[] = [
      { source_key: 'f', status: 'failed', started_at: '2026-11-14T10:00:00Z', finished_at: '2026-11-14T10:01:00Z', error_message: 'HTTP 503' },
      { source_key: 'p', status: 'partial', started_at: '2026-11-14T10:00:00Z', finished_at: '2026-11-14T10:05:00Z' },
      { source_key: 'o', status: 'running', started_at: '2026-11-14T02:00:00Z', finished_at: null },
      { source_key: 'r', status: 'running', started_at: '2026-11-14T11:00:00Z', finished_at: null },
      { source_key: 's', status: 'success', started_at: '2026-11-14T10:00:00Z', finished_at: '2026-11-14T10:02:00Z' },
    ];
    const cur = syntheticReport({ f: { total: 1, withDate: 1 }, p: { total: 1, withDate: 1 }, o: { total: 1, withDate: 1 }, r: { total: 1, withDate: 1 }, s: { total: 1, withDate: 1 } });
    const h = evaluateSourceHealth({ current: cur, runs, now: NOW });
    expect(h.alerts.map((x) => [x.source_key, x.code, x.severity])).toEqual([
      ['f', 'run_failed', 'critical'],
      ['o', 'run_open', 'critical'],
      ['p', 'run_partial', 'warning'],
    ]);
    expect(h.alerts[0]!.data['error_message']).toBe('HTTP 503');
    expect(h.alerts[1]!.data['open_hours']).toBe(10);
  });

  it('fonte só presente nas execuções (sem itens) → zero_items + alerta da execução', () => {
    const h = evaluateSourceHealth({
      current: syntheticReport({}),
      runs: [{ source_key: 'x', status: 'failed', started_at: NOW, finished_at: NOW }],
      now: NOW,
    });
    expect(h.sources[0]!.alerts.map((a) => a.code)).toEqual(['zero_items', 'run_failed']);
  });

  it('frescura: limite exacto de 14 dias não alerta; data inválida vira nota; null é ignorado', () => {
    const cur = syntheticReport({ a: { total: 1, withDate: 1 }, b: { total: 1, withDate: 1 }, c: { total: 1, withDate: 1 } });
    const h = evaluateSourceHealth({
      current: cur,
      lastPublishedAt: { a: '2026-10-31T12:00:00.000Z', b: 'nao-e-data', c: null },
      now: NOW,
    });
    expect(h.alerts).toEqual([]);
    expect(h.notes).toContain('b: data do último post inválida ("nao-e-data") — frescura não avaliada');
  });

  it('started_at inválido numa execução running vira nota, sem alerta', () => {
    const h = evaluateSourceHealth({
      current: syntheticReport({ a: { total: 1, withDate: 1 } }),
      runs: [{ source_key: 'a', status: 'running', started_at: 'x', finished_at: null }],
      now: NOW,
    });
    expect(h.alerts).toEqual([]);
    expect(h.notes[0]).toContain("started_at inválido");
  });

  it('now inválido → erro explícito (determinismo)', () => {
    expect(() => evaluateSourceHealth({ current: syntheticReport({}), now: 'ontem' })).toThrow(/now inválido/);
  });

  it('tudo saudável → status ok e resumo OK', () => {
    const r = syntheticReport({ a: { total: 5, withDate: 5 } });
    const h = evaluateSourceHealth({ current: r, previous: r, lastPublishedAt: { a: '2026-11-13T00:00:00Z' }, now: NOW });
    expect(h.status).toBe('ok');
    expect(h.notes).toEqual([]);
    expect(formatSourceHealthSummary(h)).toContain(': OK');
  });
});
