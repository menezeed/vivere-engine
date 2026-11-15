/**
 * src/pipeline/metrics/runQualityMetrics.ts
 *
 * L4 — métricas de qualidade de UMA execução de ingestão, por fonte
 * (source_key) e cidade. Função PURA: não lê nem escreve na base de
 * dados, não faz pedidos de rede e não depende do relógio (a data de
 * geração é recebida por parâmetro). Serve para dry-runs com fixtures
 * e, mais tarde, para alimentar o relatório de ingestion_runs.
 *
 * Definições (deliberadamente simples e auditáveis):
 *   - com data:  o item tem pelo menos 1 RawOccurrence (date é
 *                obrigatório em RawOccurrence). Itens cuja data não foi
 *                extraída — por exemplo "8 de novembro" sem ano, que o
 *                motor não infere — chegam com occurrences: [] e contam
 *                como SEM data.
 *   - com hora:  pelo menos 1 ocorrência com time !== null.
 *   - com local: venue_mention !== null.
 *   - local geocodificável: venue_mention com endereço textual
 *                (raw_address_text) OU com nome explícito
 *                (confidence_hint 'explicit_name'). RawActivityItem não
 *                tem coordenadas; a geocodificação/resolução é do
 *                Entity Resolution, não do Collector.
 *   - duplicados: critério JÁ existente no código para actividades —
 *                a chave de idempotência (source_key, source_item_id)
 *                dentro da mesma execução (UNIQUE em raw_activity_items,
 *                ver RawActivityItemRepository / ADR-0013). Conta-se
 *                cada repetição além da primeira. Não existe dedupe
 *                cross-source de actividades no código (o Entity
 *                Resolution trata de venues), por isso esta métrica não
 *                o tenta.
 *   - gate geográfico: o gate (ADR-0022) só classifica itens com
 *                lat/lng (RawVenueItem). Para actividades a métrica é
 *                "não aplicável"; se quem chama tiver os buckets do gate
 *                de venues da mesma execução, pode passá-los em
 *                options.venueGateBuckets e o relatório resume-os.
 *   - atraso:    collected_at − data de publicação na fonte, em horas.
 *                RawActivityItem não guarda a data de publicação; quem
 *                chama fornece-a por options.resolvePublishedAt (ex.:
 *                date_gmt do post WordPress). Itens sem data de
 *                publicação ficam fora da média e são contados à parte.
 */

import type { RawActivityItem } from '../../types/RawActivityItem';
import type { GeographicBucket } from '../stages/01-geographic-gate/types';
import { getWordPressSourceConfigBySourceKey } from '../../collectors/wordpress-content/config/registry';

export interface RateMetric {
  count: number;
  /** Percentagem com 1 casa decimal; null quando o total é 0. */
  pct: number | null;
}

export interface DelayMetric {
  /** Itens com data de publicação conhecida e válida. */
  items_with_published_at: number;
  mean_hours: number | null;
  median_hours: number | null;
  max_hours: number | null;
}

export interface GroupQualityMetrics {
  source_key: string;
  /** null quando a fonte não declara cidade (region_metadata) */
  city: string | null;
  total_items: number;
  with_date: RateMetric;
  with_time: RateMetric;
  with_venue_mention: RateMetric;
  with_geocodable_venue: RateMetric;
  duplicates: RateMetric;
  publication_delay: DelayMetric;
}

export interface GeographicGateSummary {
  total: number;
  inside_radius: RateMetric;
  buffer_zone: RateMetric;
  outside_region: RateMetric;
}

export interface RunQualityReport {
  run_id: string | null;
  generated_at: string;
  totals: Omit<GroupQualityMetrics, 'source_key' | 'city'>;
  by_group: GroupQualityMetrics[];
  /** null = não aplicável a actividades e nenhum bucket de venues fornecido */
  geographic_gate: GeographicGateSummary | null;
  notes: string[];
}

export interface RunQualityOptions {
  runId?: string | null;
  /** ISO 8601. Obrigatório para manter a função determinística. */
  generatedAt: string;
  /** Cidade por source_key. Por omissão: region_metadata.city do registry WordPress. */
  resolveCity?: (sourceKey: string) => string | null;
  /** Data de publicação na fonte (ISO 8601) de cada item, se conhecida. */
  resolvePublishedAt?: (item: RawActivityItem) => string | null;
  /** Buckets do gate geográfico aplicado aos VENUES da mesma execução. */
  venueGateBuckets?: readonly GeographicBucket[];
}

const HOUR_MS = 60 * 60 * 1000;

export function defaultResolveCity(sourceKey: string): string | null {
  return getWordPressSourceConfigBySourceKey(sourceKey)?.region_metadata?.city ?? null;
}

function rate(count: number, total: number): RateMetric {
  return { count, pct: total === 0 ? null : Math.round((count / total) * 1000) / 10 };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function hasDate(item: RawActivityItem): boolean {
  return item.occurrences.length > 0;
}

export function hasTime(item: RawActivityItem): boolean {
  return item.occurrences.some((o) => o.time !== null);
}

export function hasGeocodableVenue(item: RawActivityItem): boolean {
  const v = item.venue_mention;
  if (v === null) return false;
  return (v.raw_address_text !== null && v.raw_address_text.trim() !== '') || v.confidence_hint === 'explicit_name';
}

function delayMetric(
  items: readonly RawActivityItem[],
  resolvePublishedAt: ((item: RawActivityItem) => string | null) | undefined,
): DelayMetric {
  const delays: number[] = [];
  if (resolvePublishedAt) {
    for (const item of items) {
      const published = resolvePublishedAt(item);
      if (published === null) continue;
      const p = Date.parse(published);
      const c = Date.parse(item.collected_at);
      if (Number.isNaN(p) || Number.isNaN(c)) continue;
      delays.push((c - p) / HOUR_MS);
    }
  }
  if (delays.length === 0) {
    return { items_with_published_at: 0, mean_hours: null, median_hours: null, max_hours: null };
  }
  const sorted = [...delays].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return {
    items_with_published_at: delays.length,
    mean_hours: round1(delays.reduce((s, d) => s + d, 0) / delays.length),
    median_hours: round1(median),
    max_hours: round1(sorted[sorted.length - 1]!),
  };
}

function groupMetrics(
  items: readonly RawActivityItem[],
  options: RunQualityOptions,
): Omit<GroupQualityMetrics, 'source_key' | 'city'> {
  const total = items.length;
  const seen = new Set<string>();
  let duplicates = 0;
  for (const item of items) {
    const key = `${item.source_key}\u0000${item.source_item_id}`;
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return {
    total_items: total,
    with_date: rate(items.filter(hasDate).length, total),
    with_time: rate(items.filter(hasTime).length, total),
    with_venue_mention: rate(items.filter((i) => i.venue_mention !== null).length, total),
    with_geocodable_venue: rate(items.filter(hasGeocodableVenue).length, total),
    duplicates: rate(duplicates, total),
    publication_delay: delayMetric(items, options.resolvePublishedAt),
  };
}

function summarizeGate(buckets: readonly GeographicBucket[]): GeographicGateSummary {
  const total = buckets.length;
  const count = (b: GeographicBucket): number => buckets.filter((x) => x === b).length;
  return {
    total,
    inside_radius: rate(count('inside_radius'), total),
    buffer_zone: rate(count('buffer_zone'), total),
    outside_region: rate(count('outside_region'), total),
  };
}

export function computeRunQualityMetrics(
  items: readonly RawActivityItem[],
  options: RunQualityOptions,
): RunQualityReport {
  const resolveCity = options.resolveCity ?? defaultResolveCity;

  const groups = new Map<string, RawActivityItem[]>();
  for (const item of items) {
    const list = groups.get(item.source_key);
    if (list) list.push(item);
    else groups.set(item.source_key, [item]);
  }

  const byGroup: GroupQualityMetrics[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sourceKey, groupItems]) => ({
      source_key: sourceKey,
      city: resolveCity(sourceKey),
      ...groupMetrics(groupItems, options),
    }));

  const notes: string[] = [
    'duplicados: chave de idempotência (source_key, source_item_id) dentro da execução; não há dedupe cross-source de actividades no código.',
  ];
  if (!options.venueGateBuckets) {
    notes.push('gate geográfico: não aplicável a actividades (sem lat/lng); nenhum bucket de venues fornecido.');
  }
  if (!options.resolvePublishedAt) {
    notes.push('atraso de publicação: sem data de publicação fornecida (resolvePublishedAt).');
  }

  return {
    run_id: options.runId ?? null,
    generated_at: options.generatedAt,
    totals: groupMetrics(items, options),
    by_group: byGroup,
    geographic_gate: options.venueGateBuckets ? summarizeGate(options.venueGateBuckets) : null,
    notes,
  };
}

function fmtRate(r: RateMetric): string {
  return r.pct === null ? `${r.count} (—)` : `${r.count} (${r.pct.toFixed(1)}%)`;
}

function fmtDelay(d: DelayMetric): string {
  if (d.mean_hours === null) return 'sem dados';
  return `média ${d.mean_hours} h, mediana ${d.median_hours} h, máx. ${d.max_hours} h (n=${d.items_with_published_at})`;
}

/** Resumo legível (pt) do relatório, para logs e para o PO. */
export function formatRunQualitySummary(report: RunQualityReport): string {
  const lines: string[] = [];
  lines.push(`Execução ${report.run_id ?? '(sem id)'} — ${report.generated_at}`);
  const block = (label: string, m: Omit<GroupQualityMetrics, 'source_key' | 'city'>): void => {
    lines.push(`${label}: ${m.total_items} itens`);
    lines.push(`  com data: ${fmtRate(m.with_date)} | com hora: ${fmtRate(m.with_time)}`);
    lines.push(`  com local: ${fmtRate(m.with_venue_mention)} | local geocodificável: ${fmtRate(m.with_geocodable_venue)}`);
    lines.push(`  duplicados: ${fmtRate(m.duplicates)} | atraso: ${fmtDelay(m.publication_delay)}`);
  };
  for (const g of report.by_group) {
    block(`${g.source_key} (${g.city ?? 'cidade desconhecida'})`, g);
  }
  block('TOTAL', report.totals);
  if (report.geographic_gate) {
    const gg = report.geographic_gate;
    lines.push(
      `Gate geográfico (venues): ${gg.total} — dentro ${fmtRate(gg.inside_radius)}, margem ${fmtRate(gg.buffer_zone)}, fora ${fmtRate(gg.outside_region)}`,
    );
  } else {
    lines.push('Gate geográfico: não aplicável a actividades');
  }
  for (const n of report.notes) lines.push(`nota: ${n}`);
  return lines.join('\n');
}
