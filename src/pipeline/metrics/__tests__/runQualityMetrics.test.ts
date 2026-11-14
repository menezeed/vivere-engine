import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeRunQualityMetrics,
  formatRunQualitySummary,
  type RunQualityOptions,
} from '../runQualityMetrics';
import { mapToRawActivityItems } from '../../../collectors/wordpress-content/mapToRawActivityItems';
import { AVAILABLE_INSTANCES } from '../../../collectors/wordpress-content/config/registry';
import type { WordPressPost } from '../../../collectors/wordpress-content/WordPressApiClient';
import type { RawActivityItem } from '../../../types/RawActivityItem';

const COLLECTED_AT = '2026-11-14T12:00:00.000Z';
const GENERATED_AT = '2026-11-14T12:30:00.000Z';
const FIXTURES = ['cabo-frio', 'sao-pedro-da-aldeia', 'rio-das-ostras', 'buzios'] as const;

/** date_gmt do WordPress não traz fuso; é UTC por definição. */
function gmtToIso(dateGmt: string): string {
  return `${dateGmt}Z`;
}

function loadPosts(instance: string): WordPressPost[] {
  const url = new URL(`../../../collectors/wordpress-content/__tests__/fixtures/${instance}.posts.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as WordPressPost[];
}

/** Corre o mapeamento real de cada instância sobre as fixtures; collected_at fixo para determinismo. */
function buildRun(): { items: RawActivityItem[]; publishedAtByPostId: Map<number, string> } {
  const items: RawActivityItem[] = [];
  const publishedAtByPostId = new Map<number, string>();
  for (const instance of FIXTURES) {
    const config = AVAILABLE_INSTANCES[instance]!;
    for (const post of loadPosts(instance)) {
      const published = new Date(gmtToIso(post.date_gmt));
      publishedAtByPostId.set(post.id, gmtToIso(post.date_gmt));
      const result = mapToRawActivityItems(
        {
          id: post.id,
          title: post.title.rendered,
          contentHtml: post.content.rendered,
          link: post.link,
          publishedAt: {
            year: published.getUTCFullYear(),
            month: published.getUTCMonth() + 1,
            isoDate: post.date_gmt,
          },
          imageUrl: null,
        },
        config,
      );
      items.push(...result.items.map((i) => ({ ...i, collected_at: COLLECTED_AT })));
    }
  }
  return { items, publishedAtByPostId };
}

function options(publishedAtByPostId: Map<number, string>): RunQualityOptions {
  return {
    runId: 'dry-run-fixtures',
    generatedAt: GENERATED_AT,
    resolvePublishedAt: (item) => publishedAtByPostId.get(item.raw_payload['wp_post_id'] as number) ?? null,
  };
}

function syntheticItem(overrides: Partial<RawActivityItem>): RawActivityItem {
  return {
    source_key: 'fonte_teste',
    source_item_id: '1_0',
    collected_at: COLLECTED_AT,
    title: 'Item',
    description: null,
    raw_category_text: null,
    occurrences: [],
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
    ...overrides,
  };
}

describe('computeRunQualityMetrics — fixtures das 4 fontes WordPress', () => {
  const { items, publishedAtByPostId } = buildRun();
  const report = computeRunQualityMetrics(items, options(publishedAtByPostId));
  const group = (sourceKey: string) => report.by_group.find((g) => g.source_key === sourceKey)!;

  it('agrupa por source_key, com a cidade vinda do registry, por ordem alfabética', () => {
    expect(report.by_group.map((g) => [g.source_key, g.city])).toEqual([
      ['prefeitura_buzios', 'Armação dos Búzios'],
      ['prefeitura_cabo_frio', 'Cabo Frio'],
      ['prefeitura_rio_das_ostras', 'Rio das Ostras'],
      ['prefeitura_sao_pedro_da_aldeia', 'São Pedro da Aldeia'],
    ]);
  });

  it('Cabo Frio: blocos estruturados com data, hora e local explícito → 100%', () => {
    const g = group('prefeitura_cabo_frio');
    expect(g.total_items).toBe(3);
    expect(g.with_date).toEqual({ count: 3, pct: 100 });
    expect(g.with_time).toEqual({ count: 3, pct: 100 });
    expect(g.with_geocodable_venue).toEqual({ count: 3, pct: 100 });
  });

  it('Rio das Ostras: datas sem ano ("8 de novembro") contam como SEM data', () => {
    const g = group('prefeitura_rio_das_ostras');
    expect(g.total_items).toBe(2);
    expect(g.with_date).toEqual({ count: 0, pct: 0 });
    expect(g.with_time).toEqual({ count: 0, pct: 0 });
    expect(g.with_venue_mention).toEqual({ count: 2, pct: 100 });
  });

  it('São Pedro: item só com recorrência (sem data) e local inferido do contexto não é geocodificável', () => {
    const g = group('prefeitura_sao_pedro_da_aldeia');
    expect(g.total_items).toBe(1);
    expect(g.with_date.count).toBe(0);
    expect(g.with_venue_mention.count).toBe(1);
    expect(g.with_geocodable_venue.count).toBe(0);
  });

  it('Búzios: narrativa com data e hora, sem local extraído', () => {
    const g = group('prefeitura_buzios');
    expect(g.total_items).toBe(1);
    expect(g.with_date).toEqual({ count: 1, pct: 100 });
    expect(g.with_time).toEqual({ count: 1, pct: 100 });
    expect(g.with_venue_mention).toEqual({ count: 0, pct: 0 });
  });

  it('totais da execução', () => {
    expect(report.totals.total_items).toBe(7);
    expect(report.totals.with_date).toEqual({ count: 4, pct: 57.1 });
    expect(report.totals.with_time).toEqual({ count: 4, pct: 57.1 });
    expect(report.totals.with_venue_mention).toEqual({ count: 6, pct: 85.7 });
    expect(report.totals.with_geocodable_venue).toEqual({ count: 5, pct: 71.4 });
    expect(report.totals.duplicates).toEqual({ count: 0, pct: 0 });
  });

  it('atraso de publicação: Búzios publicado a 20/10 18:08:51 UTC, recolhido a 14/11 12:00 UTC', () => {
    const d = group('prefeitura_buzios').publication_delay;
    expect(d.items_with_published_at).toBe(1);
    expect(d.mean_hours).toBe(593.9);
    expect(report.totals.publication_delay.items_with_published_at).toBe(7);
  });

  it('gate geográfico não aplicável a actividades quando não há buckets de venues', () => {
    expect(report.geographic_gate).toBeNull();
    expect(report.notes.some((n) => n.includes('gate geográfico'))).toBe(true);
  });

  it('o relatório é JSON serializável e o resumo legível menciona cada fonte e o total', () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    const summary = formatRunQualitySummary(report);
    expect(summary).toContain('Execução dry-run-fixtures');
    expect(summary).toContain('prefeitura_rio_das_ostras (Rio das Ostras): 2 itens');
    expect(summary).toContain('com data: 0 (0.0%)');
    expect(summary).toContain('TOTAL: 7 itens');
    expect(summary).toContain('Gate geográfico: não aplicável a actividades');
  });
});

describe('computeRunQualityMetrics — casos-limite', () => {
  it('execução vazia: percentagens null, sem divisão por zero', () => {
    const report = computeRunQualityMetrics([], { generatedAt: GENERATED_AT });
    expect(report.totals.total_items).toBe(0);
    expect(report.totals.with_date).toEqual({ count: 0, pct: null });
    expect(report.by_group).toEqual([]);
    expect(report.run_id).toBeNull();
    expect(formatRunQualitySummary(report)).toContain('com data: 0 (—)');
  });

  it('duplicados pela chave de idempotência (source_key, source_item_id); mesmo id noutra fonte não conta', () => {
    const items = [
      syntheticItem({ source_item_id: '1_0' }),
      syntheticItem({ source_item_id: '1_0' }),
      syntheticItem({ source_item_id: '1_0' }),
      syntheticItem({ source_item_id: '2_0' }),
      syntheticItem({ source_key: 'outra_fonte', source_item_id: '1_0' }),
    ];
    const report = computeRunQualityMetrics(items, { generatedAt: GENERATED_AT, resolveCity: () => null });
    expect(report.totals.duplicates).toEqual({ count: 2, pct: 40 });
    expect(report.by_group.find((g) => g.source_key === 'fonte_teste')!.duplicates.count).toBe(2);
    expect(report.by_group.find((g) => g.source_key === 'outra_fonte')!.duplicates.count).toBe(0);
  });

  it('fonte desconhecida do registry → cidade null', () => {
    const report = computeRunQualityMetrics([syntheticItem({})], { generatedAt: GENERATED_AT });
    expect(report.by_group[0]!.city).toBeNull();
    expect(formatRunQualitySummary(report)).toContain('fonte_teste (cidade desconhecida)');
  });

  it('local geocodificável: endereço textual conta mesmo com nome inferido; nome ambíguo sem endereço não conta', () => {
    const items = [
      syntheticItem({ source_item_id: 'a', venue_mention: { raw_text: 'Praça', raw_address_text: 'Rua Exemplo, 10', confidence_hint: 'inferred_from_context' } }),
      syntheticItem({ source_item_id: 'b', venue_mention: { raw_text: 'Ali', raw_address_text: null, confidence_hint: 'ambiguous' } }),
      syntheticItem({ source_item_id: 'c', venue_mention: { raw_text: 'Ali', raw_address_text: '  ', confidence_hint: 'ambiguous' } }),
    ];
    const report = computeRunQualityMetrics(items, { generatedAt: GENERATED_AT });
    expect(report.totals.with_venue_mention.count).toBe(3);
    expect(report.totals.with_geocodable_venue.count).toBe(1);
  });

  it('hora: basta uma ocorrência com time; ocorrência só com data não conta', () => {
    const items = [
      syntheticItem({ source_item_id: 'a', occurrences: [{ date: '2026-11-20', time: null, end_date: null, end_time: null }] }),
      syntheticItem({
        source_item_id: 'b',
        occurrences: [
          { date: '2026-11-20', time: null, end_date: null, end_time: null },
          { date: '2026-11-21', time: '19:00', end_date: null, end_time: null },
        ],
      }),
    ];
    const report = computeRunQualityMetrics(items, { generatedAt: GENERATED_AT });
    expect(report.totals.with_date.count).toBe(2);
    expect(report.totals.with_time.count).toBe(1);
  });

  it('atraso: média, mediana e máximo; datas inválidas ou ausentes ficam de fora', () => {
    const published: Record<string, string | null> = {
      a: '2026-11-14T10:00:00.000Z', // 2 h
      b: '2026-11-14T08:00:00.000Z', // 4 h
      c: '2026-11-13T12:00:00.000Z', // 24 h
      d: null,
      e: 'data-invalida',
    };
    const items = Object.keys(published).map((id) => syntheticItem({ source_item_id: id }));
    const report = computeRunQualityMetrics(items, {
      generatedAt: GENERATED_AT,
      resolvePublishedAt: (i) => published[i.source_item_id] ?? null,
    });
    expect(report.totals.publication_delay).toEqual({
      items_with_published_at: 3,
      mean_hours: 10,
      median_hours: 4,
      max_hours: 24,
    });
  });

  it('sem resolvePublishedAt → atraso sem dados e nota explícita', () => {
    const report = computeRunQualityMetrics([syntheticItem({})], { generatedAt: GENERATED_AT });
    expect(report.totals.publication_delay.mean_hours).toBeNull();
    expect(report.notes.some((n) => n.includes('atraso'))).toBe(true);
  });

  it('buckets do gate de venues fornecidos → resumo com % fora da região', () => {
    const report = computeRunQualityMetrics([], {
      generatedAt: GENERATED_AT,
      venueGateBuckets: ['inside_radius', 'inside_radius', 'buffer_zone', 'outside_region'],
    });
    expect(report.geographic_gate).toEqual({
      total: 4,
      inside_radius: { count: 2, pct: 50 },
      buffer_zone: { count: 1, pct: 25 },
      outside_region: { count: 1, pct: 25 },
    });
    expect(formatRunQualitySummary(report)).toContain('fora 1 (25.0%)');
  });
});
