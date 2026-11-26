/**
 * Preview (dry-run) da Better (GLL) via OpenActive — piloto UK, fontes novas.
 *
 * NÃO grava nada em BD: não importa Supabase, não cria ingestion_run.
 * Lê o feed RPDE session-series (nacional) com no máximo 8 pedidos, 3 s entre
 * pedidos, User-Agent identificado, e pára em HTTP 429/403. Cada página é
 * reduzida de imediato às séries de Richmond: o snapshot escrito contém SÓ
 * essas séries (allowlist), nunca o feed nacional.
 *
 * Uso:
 *   npx tsx scripts/preview-better.ts --out=<snapshot.json> [--today=YYYY-MM-DD]
 *   npx tsx scripts/preview-better.ts --out=<snapshot.json> --feed-dir=<pasta com páginas RPDE *.json>   (offline, 0 pedidos)
 *   npx tsx scripts/preview-better.ts --out=<novo.json> --from-snapshot=<snapshot anterior>   (recalcula o relatório, 0 pedidos)
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BETTER_CONFIG } from '../src/collectors/openactive-better/config';
import { readFeed, readFeedPages, parseBetterSnapshot, type FetchJson } from '../src/collectors/openactive-better/betterFeed';
import { londonToday, planFromSeries, seriesIsActive } from '../src/collectors/openactive-better/betterSeries';
import { pilotDuplicates, type U3aDataset } from '../src/collectors/openactive-better/betterDedup';

const arg = (argv: readonly string[], name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export async function main(argv: readonly string[] = process.argv, fetchJson?: FetchJson): Promise<void> {
  const out = arg(argv, 'out');
  if (!out) throw new Error('--out=<snapshot.json> é obrigatório');
  if (argv.includes('--apply')) throw new Error('RECUSA: preview-better não escreve em BD (usar ingest-better.ts)');
  const feedDir = arg(argv, 'feed-dir');
  const fromSnapshot = arg(argv, 'from-snapshot');
  const today = arg(argv, 'today') ?? londonToday();
  const previous = fromSnapshot ? parseBetterSnapshot(JSON.parse(readFileSync(fromSnapshot, 'utf8'))) : null;

  const read = previous
    ? {
      series: previous.series, requests: previous.fonte.pedidos_http, pages_with_items: previous.fonte.paginas_com_itens,
      items_read: previous.fonte.itens_lidos, deleted_read: previous.fonte.itens_apagados_lidos,
      complete: previous.fonte.feed_completo, stop_reason: previous.fonte.paragem,
    }
    : feedDir
    ?{ ...readFeedPages(readdirSync(feedDir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(feedDir, f), 'utf8')))), requests: 0 }
    : await readFeed({
      fetchJson: fetchJson ?? (async (url, init) => { const r = await fetch(url, init); return { status: r.status, json: () => r.json() }; }),
    });

  // Recalculado: mantém a data da recolha (é o collected_at da ingestão).
  const generatedAt = previous?.gerado_em ?? new Date().toISOString();
  const plan = planFromSeries(read.series, today, generatedAt);
  const u3a = JSON.parse(readFileSync(new URL('../src/review-api/eligibility/richmond-u3a-60plus.v1.json', import.meta.url), 'utf8')) as U3aDataset;
  const dups = pilotDuplicates(plan.items, u3a);
  const byClass = plan.proposals.reduce<Record<string, number>>((m, p) => (m[p.classification] = (m[p.classification] ?? 0) + 1, m), {});

  const snapshot = {
    gerado_em: generatedAt,
    hoje: today,
    dry_run: true as const,
    escrita_em_bd: false as const,
    fonte: {
      source_key: BETTER_CONFIG.source_key,
      feed_url: previous ? previous.fonte.feed_url : feedDir ? `ficheiro local: ${feedDir}` : BETTER_CONFIG.feed_url,
      pedidos_http: read.requests,
      pedidos_http_nesta_execucao: previous || feedDir ? 0 : read.requests,
      paginas_com_itens: read.pages_with_items,
      itens_lidos: read.items_read,
      itens_apagados_lidos: read.deleted_read,
      feed_completo: read.complete,
      paragem: read.stop_reason,
    },
    recalculado_em: previous ? new Date().toISOString() : null,
    produto: BETTER_CONFIG.product_key,
    licenca: BETTER_CONFIG.licence,
    nota_privacidade: 'Só séries de Richmond e só campos da allowlist (sem descrições, sem leaders/instrutores, sem contactos).',
    series: read.series,
    resumo: {
      series_richmond: read.series.length,
      series_activas: read.series.filter(s => seriesIsActive(s, today)).length,
      series_expiradas: plan.expired.length,
      fora_da_insercao: plan.held.length,
      atividades_previstas: plan.items.length,
      ocorrencias_21_dias: plan.items.reduce((n, i) => n + i.occurrences.length, 0),
      elegibilidade_proposta: byClass,
      possiveis_duplicados_u3a: dups.u3a.length,
      possiveis_duplicados_fish: dups.fish.length,
    },
    atividades: plan.items.map(i => ({
      source_item_id: i.source_item_id,
      titulo: i.title,
      local: i.venue_mention ? `${i.venue_mention.raw_text} (${String(i.raw_payload['postcode'])})` : null,
      recorrencia: i.recurrence_text_hint,
      ocorrencias: i.occurrences.map(o => `${o.date} ${o.time ?? 'sem hora'}${o.end_time ? `–${o.end_time}` : ''}`),
      custo: i.price_text,
      url: i.external_url,
      elegibilidade: i.raw_payload['eligibility_proposal'],
    })),
    expiradas: plan.expired,
    fora_da_insercao: plan.held,
    possiveis_duplicados: dups,
  };
  writeFileSync(out, JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({ fonte: snapshot.fonte, resumo: snapshot.resumo }, null, 2));
  console.log(`Snapshot: ${out}`);
  if (!read.complete) console.warn(`AVISO: feed incompleto (${read.stop_reason}); a ingestão --apply recusa este snapshot.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
}
