/**
 * Ingestão da u3a de Richmond upon Thames — piloto UK (U6). SÓ STAGING.
 *
 *   npx tsx scripts/ingest-u3a.ts --dry-run          # sem cliente Supabase; lê a fonte e o postcodes.io
 *   npx tsx --env-file=<ficheiro fora do repo> scripts/ingest-u3a.ts   # grava em staging (envGuard)
 *
 * Opções: --dry-run, --report=<caminho.json> (relatório sem dados pessoais).
 *
 * Ordem: venues (u3a_venue → postcodes.io → filtro → gate) e depois
 * actividades (eventos futuros + grupos activos). Nunca publica: a
 * publicação de produtos não-BR está bloqueada até U8 (publicationGuard).
 * O modo real usa RepositoryFactory.forSupabase(), que passa pelo envGuard
 * (produção recusada).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { U3aApiClient } from '../src/collectors/u3a-siteworks/U3aApiClient';
import { U3aSiteWorksCollector } from '../src/collectors/u3a-siteworks/U3aSiteWorksCollector';
import { U3A_RICHMOND_CONFIG } from '../src/collectors/u3a-siteworks/config';
import { PostcodesIoClient } from '../src/collectors/geocoding/PostcodesIoClient';
import { VIVERE_60_PLUS_UK_TEST_VENUE_FILTER_RULES } from '../src/pipeline/stages/00-filter-venue/products/vivere-60-plus-uk-test';
import { filterVenueItems } from '../src/pipeline/stages/00-filter-venue';
import { applyGeographicGate } from '../src/pipeline/stages/01-geographic-gate';
import { detectRecurrenceItems } from '../src/pipeline/stages/02-recurrence-detection';
import { IngestionOrchestrator } from '../src/persistence/orchestration/IngestionOrchestrator';
import { reposForRun } from '../src/persistence/orchestration/reposForRun';

/** Data local (YYYY-MM-DD) num fuso IANA. */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const reportPath = argv.find((a) => a.startsWith('--report='))?.slice('--report='.length);
  const cfg = U3A_RICHMOND_CONFIG;
  const nowIso = new Date().toISOString();
  const today = localDate(nowIso, cfg.timezone);

  const collector = new U3aSiteWorksCollector(
    new U3aApiClient(cfg.base_url, cfg.user_agent),
    new PostcodesIoClient(),
    cfg,
    today,
  );

  // Modo real: repositórios (envGuard) ANTES de qualquer pedido às fontes.
  const repos = await reposForRun(dryRun);
  const orchestrator = new IngestionOrchestrator(repos);

  console.log(`\n=== u3a Richmond — ${dryRun ? 'DRY-RUN (sem escrita)' : 'ESCRITA EM STAGING'} — produto ${cfg.product_key}, hoje ${today} (${cfg.timezone}) ===`);

  const venueSummary = await orchestrator.runVenueIngestion(collector.venueCollector(), cfg, VIVERE_60_PLUS_UK_TEST_VENUE_FILTER_RULES, { dryRun });
  const activitySummary = await orchestrator.runActivityIngestion(collector.activityCollector(), cfg, { dryRun });

  // Relatório (dados já sanitizados pelo collector; re-lidos da cache, sem novos pedidos).
  const venues = await collector.collectVenues();
  const acts = await collector.collectActivities();
  const gated = applyGeographicGate(filterVenueItems(venues.items, VIVERE_60_PLUS_UK_TEST_VENUE_FILTER_RULES), cfg.regions!);
  const recurrence = detectRecurrenceItems(acts.items);
  const count = (xs: readonly { message: string }[]) => xs.reduce<Record<string, number>>((a, e) => ((a[e.message] = (a[e.message] ?? 0) + 1), a), {});

  const report = {
    generated_at: nowIso, today, dry_run: dryRun, source_key: cfg.source_key, product_key: cfg.product_key,
    venue_summary: venueSummary, activity_summary: activitySummary,
    venue_exclusions: count(venues.errors), activity_exclusions: count(acts.errors),
    venues: gated.map((g) => ({
      source_item_id: g.item.source_item_id, name: g.item.name, address: g.item.address,
      lat: g.item.lat, lng: g.item.lng, admin_district: g.item.raw_payload['admin_district'] ?? null,
      filter: g.filter.decision, geographic: g.geographic?.bucket ?? null,
      distance_m: g.geographic ? Math.round(g.geographic.distanceMeters) : null, url: g.item.website,
    })),
    activities: recurrence.map(({ item, recurrence: r }) => ({
      source_item_id: item.source_item_id, kind: item.source_item_id.split(':')[0], title: item.title,
      category: item.raw_category_text, occurrences: item.occurrences, when_text: item.recurrence_text_hint,
      recurrence: r, venue: item.venue_mention?.raw_text ?? null, venue_confidence: item.venue_mention?.confidence_hint ?? null,
      url: item.external_url,
    })),
  };

  console.log(`Venues:      recolhidos ${venueSummary.rawItemsCollected}, persistidos ${venueSummary.rawItemsPersisted}, staged ${venueSummary.stagedItems}, fora da região ${venueSummary.geoExcludedItems}, excluídos ${venueSummary.rawItemsErrored} ${JSON.stringify(report.venue_exclusions)}`);
  console.log(`Actividades: recolhidas ${activitySummary.rawItemsCollected}, persistidas ${activitySummary.rawItemsPersisted}, staged ${activitySummary.stagedItems}, excluídas ${activitySummary.rawItemsErrored} ${JSON.stringify(report.activity_exclusions)}`);
  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Relatório: ${reportPath}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
