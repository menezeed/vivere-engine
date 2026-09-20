/**
 * Dry-run do GooglePlacesCollector + Venue Filtering Engine — genérico,
 * funciona com qualquer config de produto da plataforma Vivere.
 *
 * O script em si NUNCA menciona "Região dos Lagos" ou "Cabo Frio" como
 * lógica — ele só importa a config selecionada via argumento de linha
 * de comando e a passa ao motor. Adicionar um novo produto não exige
 * tocar neste arquivo, só criar um novo config/<produto>.ts.
 *
 * O QUE ESTE SCRIPT FAZ:
 * - Chama a Google Places API de verdade (textSearch + enriquecimento)
 * - Aplica dedupe por place_id dentro da execução
 * - Aplica o Venue Filtering Engine (regras heurísticas, sem IA) sobre
 *   cada venue coletado
 * - Imprime um resumo por decisão, seguido do detalhe por categoria
 * - Imprime estatísticas de custo e erros
 *
 * O QUE ESTE SCRIPT NUNCA FAZ:
 * - Não escreve em staging.venues_staging
 * - Não escreve em staging.activities_staging
 * - Não toca public.venues nem public.activities
 * - Não chama nenhuma função de promoção
 *
 * Uso:
 *   GOOGLE_PLACES_API_KEY=xxx npx tsx scripts/dry-run-google-places.ts
 *   GOOGLE_PLACES_API_KEY=xxx npx tsx scripts/dry-run-google-places.ts --product=vivere-60-mais
 *   GOOGLE_PLACES_API_KEY=xxx npx tsx scripts/dry-run-google-places.ts --product=vivere-60-mais --region=sp_brooklin_pilot
 *   GOOGLE_PLACES_API_KEY=xxx npx tsx scripts/dry-run-google-places.ts --limit=2   (só as 2 primeiras queries, para teste rápido)
 *
 * --region=<region_key> restringe a execução a uma única região do
 * produto seleccionado (por region.key, o mesmo identificador usado em
 * config/<produto>.ts) — a lógica de resolução está em
 * src/lib/resolveRegionFilter.ts, PARTILHADA com
 * ingest-google-places.ts. Antes desta extração (Fase 9), a mesma
 * regra estava duplicada nos dois scripts; quando um foi corrigido, o
 * outro ficou para trás — bug real, custo real (execução do Brooklin
 * que correu as 3 regiões por engano). Esta partilha elimina essa
 * classe de erro estruturalmente — não é mais possível corrigir um
 * script e esquecer o outro, porque só existe uma implementação.
 *
 * PÓS-FILTRO GEOGRÁFICO (Sprint 9, Etapa 2 do Regional Expansion Checklist):
 * Google Places Text Search usa lat/lng + radius como VIÉS de proximidade,
 * não como corte rígido — resultados muito conhecidos (ex: museus famosos)
 * podem "vazar" para muito além do raio configurado. Este script calcula,
 * offline, a distância Haversine de cada resultado ao centro da região que
 * gerou a query (usando o lat/lng já devolvido pelo Google — zero chamadas
 * extra), e classifica cada item em inside_radius / buffer_zone /
 * outside_region, usando o radius_m já configurado para essa região.
 * Isto é só relatório — não filtra nem exclui nada automaticamente, e não
 * altera o GooglePlacesCollector nem qualquer contrato de dados. Genérico
 * para qualquer região/produto, nunca específico do Brooklin.
 *
 * TESTABILIDADE: resolveDryRunArgs() é pura (sem I/O, sem
 * process.exit) e exportada — ver
 * scripts/__tests__/dry-run-google-places.test.ts. main() só corre
 * quando este arquivo é executado diretamente (guarda de entry-point
 * abaixo), nunca quando importado por um teste.
 */

import { GooglePlacesApiClient } from '../src/collectors/google-places/GooglePlacesApiClient';
import { GooglePlacesCollector } from '../src/collectors/google-places/GooglePlacesCollector';
import { InMemoryBudgetRepo } from '../src/lib/budgetGuard';
import { VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG } from '../src/collectors/google-places/config/vivere-60-mais.js';
import { TARGETED_ER_LOOKUP_CONFIG } from '../src/collectors/google-places/config/targeted-er-lookup.js';
import type { GooglePlacesProductConfig } from '../src/collectors/google-places/config/GooglePlacesProductConfig';
import {
  filterVenueItems,
  summarizeFilterResults,
  resolveRuleSet,
  type FilteredVenueItem,
} from '../src/pipeline/stages/00-filter-venue';
import {
  VIVERE_60_MAIS_VENUE_FILTER_RULES,
  type VivereSessentaMaisRuleId,
  type VivereSessentaMaisAmbiguityLabel,
} from '../src/pipeline/stages/00-filter-venue/products/vivere-60-mais';
import { haversineMeters } from '../src/publishing/services/duplicateDetection';
import { resolveRegionFilter } from '../src/lib/resolveRegionFilter';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const AVAILABLE_PRODUCTS: Record<string, GooglePlacesProductConfig> = {
  'vivere-60-mais':      VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG,
  'targeted-er-lookup':  TARGETED_ER_LOOKUP_CONFIG,
};

const VENUE_FILTER_RESOLVED = resolveRuleSet(VIVERE_60_MAIS_VENUE_FILTER_RULES);

// ── Resolução de argumentos (pura, testável) ─────────────────────────────────

export interface DryRunArgsResolution {
  readonly productKey: string;
  readonly regionKey: string | undefined;
  readonly productConfig: GooglePlacesProductConfig;
  readonly limitQueries: number | undefined;
}

export type DryRunArgsResult =
  | { readonly ok: true; readonly result: DryRunArgsResolution }
  | { readonly ok: false; readonly error: string; readonly available: readonly string[] };

/**
 * Resolve toda a configuração efetiva a partir de argv — pura, sem
 * I/O, sem process.exit, sem chamar nenhuma API. Dois níveis de
 * resolução: --product (entre produtos disponíveis) e --region
 * (dentro do produto resolvido, via resolveRegionFilter — a mesma
 * função usada por ingest-google-places.ts).
 */
export function resolveDryRunArgs(
  argv: readonly string[],
  availableProducts: Record<string, GooglePlacesProductConfig>,
): DryRunArgsResult {
  const productArg = argv.find((a) => a.startsWith('--product='));
  const productKey = productArg ? productArg.split('=')[1]! : 'vivere-60-mais';
  const baseConfig = availableProducts[productKey];

  if (!baseConfig) {
    return {
      ok: false,
      error: `Produto "${productKey}" não encontrado`,
      available: Object.keys(availableProducts),
    };
  }

  const regionArg = argv.find((a) => a.startsWith('--region='));
  const regionKey = regionArg ? regionArg.split('=')[1] : undefined;

  const regionResult = resolveRegionFilter(baseConfig, regionKey);
  if (!regionResult.ok) {
    return { ok: false, error: `${regionResult.error} (produto "${productKey}")`, available: regionResult.available };
  }

  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limitQueries = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  return {
    ok: true,
    result: { productKey, regionKey, productConfig: regionResult.config, limitQueries },
  };
}

// ── Resto do script (inalterado na lógica, só reorganizado) ─────────────────

function groupByCategory(
  results: FilteredVenueItem<VivereSessentaMaisRuleId, VivereSessentaMaisAmbiguityLabel>[],
): Map<string, FilteredVenueItem<VivereSessentaMaisRuleId, VivereSessentaMaisAmbiguityLabel>[]> {
  const groups = new Map<string, FilteredVenueItem<VivereSessentaMaisRuleId, VivereSessentaMaisAmbiguityLabel>[]>();
  for (const r of results) {
    const key = r.item.source_category_hint;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return groups;
}

// Label de exibição construído dinamicamente a partir do ruleSet do
// produto — o script nunca menciona 'likely_fitness_generic' como
// literal fixo, só o que o ambiguity_fallback do produto declara.
const DECISION_LABEL: Record<string, string> = {
  accepted: 'ACCEPTED',
  needs_review: 'NEEDS REVIEW',
  rejected: 'REJECTED',
  [VENUE_FILTER_RESOLVED.ambiguity_fallback.label]: 'FITNESS GENÉRICO',
};

// ── Pós-filtro geográfico (offline, sem chamadas extra) ──────────────────────
//
// Genérico para qualquer região/produto — usa region.radius_m já configurado,
// nunca um valor fixo. Buffer de +500m acima do raio é uma margem de
// classificação, não um segundo raio de busca.
type GeoBucket = 'inside_radius' | 'buffer_zone' | 'outside_region';

function classifyDistance(distanceMeters: number, radiusM: number): GeoBucket {
  if (distanceMeters <= radiusM) return 'inside_radius';
  if (distanceMeters <= radiusM + 500) return 'buffer_zone';
  return 'outside_region';
}

interface GeoClassified<T> {
  readonly result: T;
  readonly distanceMeters: number;
  readonly bucket: GeoBucket;
}

/**
 * Classifica cada item pela distância ao centro da região que gerou a
 * query (via item.source_region_label → productConfig.regions). Itens
 * cuja região não é encontrada (não deveria acontecer, mas defensivo)
 * ficam de fora do relatório, nunca lançam.
 */
function classifyGeography<T extends { item: RawVenueItemLike }>(
  results: readonly T[],
  regions: readonly { display_label: string; lat: number; lng: number; radius_m: number }[],
): GeoClassified<T>[] {
  const regionByLabel = new Map(regions.map((r) => [r.display_label, r]));
  const classified: GeoClassified<T>[] = [];

  for (const r of results) {
    if (!r.item.source_region_label) continue; // defensivo — nunca deveria faltar
    const region = regionByLabel.get(r.item.source_region_label);
    if (!region) continue; // defensivo — não deveria acontecer
    const distanceMeters = haversineMeters(region.lat, region.lng, r.item.lat, r.item.lng);
    classified.push({ result: r, distanceMeters, bucket: classifyDistance(distanceMeters, region.radius_m) });
  }

  return classified;
}

interface RawVenueItemLike {
  lat: number;
  lng: number;
  source_region_label?: string;
}

function printItem(
  r: FilteredVenueItem<VivereSessentaMaisRuleId, VivereSessentaMaisAmbiguityLabel>,
  geo?: GeoClassified<FilteredVenueItem<VivereSessentaMaisRuleId, VivereSessentaMaisAmbiguityLabel>>,
) {
  const { item, filter } = r;
  const alternates = (item.raw_payload._alternate_category_hints as string[] | undefined) ?? [];
  console.log(`  • [${DECISION_LABEL[filter.decision] ?? filter.decision.toUpperCase()}] ${item.name}`);
  console.log(`    motivo do filtro: ${filter.reasoning}`);
  console.log(`    endereço: ${item.address ?? '(sem endereço)'}`);
  console.log(`    telefone: ${item.phone ?? '(não disponível)'}  ·  site: ${item.website ?? '(não disponível)'}`);
  console.log(`    google_types: ${item.google_types.join(', ') || '(nenhum)'}`);
  console.log(`    tipo de query: ${item.source_query_kind} ("${item.source_query_text}")`);
  if (geo) {
    console.log(`    distância ao centro da região: ${Math.round(geo.distanceMeters)}m (${geo.bucket})`);
  }
  if (alternates.length > 0) {
    console.log(`    também encontrado via: ${alternates.join(', ')}`);
  }
  console.log('');
}

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('Defina GOOGLE_PLACES_API_KEY no ambiente antes de rodar este script.');
    process.exit(1);
  }

  const resolution = resolveDryRunArgs(process.argv, AVAILABLE_PRODUCTS);

  if (!resolution.ok) {
    console.error(`${resolution.error}. Disponíveis: ${resolution.available.join(', ')}`);
    process.exit(1);
  }

  const { productKey, regionKey, productConfig, limitQueries } = resolution.result;

  const apiClient = new GooglePlacesApiClient(apiKey);
  const budgetRepo = new InMemoryBudgetRepo({
    provider: 'google_places',
    monthly_budget_usd: productConfig.monthly_budget_usd,
    hard_stop_enabled: productConfig.hard_stop_enabled,
    alert_threshold_pct: productConfig.alert_threshold_pct,
  });
  const collector = new GooglePlacesCollector(apiClient, budgetRepo, productConfig);

  console.log(`--- DRY RUN: Google Places Collector + Venue Filtering Engine — produto "${productKey}" ---`);
  console.log(`Regiões: ${productConfig.regions.map((r) => r.display_label).join(', ')}`);
  console.log(`Categorias: ${productConfig.categories.map((c) => c.key).join(', ')}`);
  console.log(`Orçamento mensal configurado: USD ${productConfig.monthly_budget_usd.toFixed(2)} (hard_stop: ${productConfig.hard_stop_enabled})`);
  if (limitQueries) {
    console.log(`Modo limitado: executando só as primeiras ${limitQueries} queries.`);
  } else {
    console.log(`Executando as ${productConfig.regions.length * productConfig.categories.length} queries completas.`);
  }
  console.log('Nenhuma escrita em staging ou produção ocorrerá nesta execução.\n');

  const collected = await collector.collect({ limitQueries });

  // O Venue Filtering Engine roda inteiramente em memória, sem nenhuma
  // chamada de API adicional — aplicá-lo aqui não soma custo nenhum
  // ao que já foi gasto na coleta.
  const filtered = filterVenueItems(collected.items, VIVERE_60_MAIS_VENUE_FILTER_RULES);
  const summary = summarizeFilterResults(filtered, VENUE_FILTER_RESOLVED);

  // Pós-filtro geográfico offline (Sprint 9, Etapa 2) — usa o lat/lng já
  // devolvido pelo Google, sem nenhuma chamada extra. Ver nota no cabeçalho.
  const geoClassified = classifyGeography(filtered, productConfig.regions);
  const geoByResult = new Map(geoClassified.map((g) => [g.result, g]));

  console.log('\n=== RESUMO POR DECISÃO ===\n');
  console.log(`  ACCEPTED:              ${summary.accepted}`);
  console.log(`  NEEDS REVIEW:          ${summary.needs_review}`);
  console.log(`  ${DECISION_LABEL[summary.ambiguity_fallback_label]?.padEnd(20) ?? summary.ambiguity_fallback_label}: ${summary.ambiguity_fallback}`);
  console.log(`  REJECTED:              ${summary.rejected}`);
  console.log(`  TOTAL:                 ${filtered.length}`);

  console.log('\n=== DETALHE POR CATEGORIA ===\n');
  const grouped = groupByCategory(filtered);
  for (const [categoryKey, items] of grouped) {
    const localSummary = summarizeFilterResults(items, VENUE_FILTER_RESOLVED);
    console.log(
      `--- ${categoryKey} (${items.length} venue(s) único(s) — accepted: ${localSummary.accepted}, review: ${localSummary.needs_review}, rejected: ${localSummary.rejected}) ---`,
    );
    for (const r of items) {
      printItem(r, geoByResult.get(r));
    }
  }

  if (collected.errors.length > 0) {
    console.log('\n=== ITENS DESCARTADOS NA COLETA (antes do filtro) ===\n');
    for (const err of collected.errors) {
      console.log(`  - ${err.message}${err.source_item_id ? ` (place_id: ${err.source_item_id})` : ''}`);
    }
  }

  console.log('\n=== ANÁLISE GEOGRÁFICA (pós-filtro offline, sem chamadas extra) ===\n');
  const bucketCounts: Record<GeoBucket, number> = { inside_radius: 0, buffer_zone: 0, outside_region: 0 };
  for (const g of geoClassified) bucketCounts[g.bucket]++;
  console.log(`  inside_radius:   ${bucketCounts.inside_radius}`);
  console.log(`  buffer_zone:     ${bucketCounts.buffer_zone}`);
  console.log(`  outside_region:  ${bucketCounts.outside_region}`);
  console.log(`  (sem região correspondente, excluído da análise: ${filtered.length - geoClassified.length})`);

  const outsideByCategory = new Map<string, number>();
  for (const g of geoClassified) {
    if (g.bucket !== 'outside_region') continue;
    const cat = g.result.item.source_category_hint;
    outsideByCategory.set(cat, (outsideByCategory.get(cat) ?? 0) + 1);
  }
  if (outsideByCategory.size > 0) {
    console.log('\n  outside_region por categoria:');
    for (const [cat, count] of outsideByCategory) {
      console.log(`    ${cat}: ${count}`);
    }
  }

  const acceptedOutside = geoClassified.filter(
    (g) => g.bucket === 'outside_region' && g.result.filter.decision === 'accepted',
  );
  console.log(`\n  ACCEPTED que seriam excluídos se outside_region fosse aplicado: ${acceptedOutside.length}`);
  for (const g of acceptedOutside) {
    console.log(`    - ${g.result.item.name} (${Math.round(g.distanceMeters)}m, ${g.result.item.source_category_hint})`);
  }

  const bufferSample = geoClassified.filter((g) => g.bucket === 'buffer_zone').slice(0, 10);
  if (bufferSample.length > 0) {
    console.log('\n  Amostra da buffer_zone:');
    for (const g of bufferSample) {
      console.log(`    - ${g.result.item.name} (${Math.round(g.distanceMeters)}m, ${g.result.item.source_category_hint}, ${DECISION_LABEL[g.result.filter.decision] ?? g.result.filter.decision})`);
    }
  }

  console.log('\n  ⚠ Apenas relatório — nenhum item é excluído do pipeline. outside_region marca');
  console.log('  inelegibilidade para publicação NESTA região — o dado permanece rastreável em');
  console.log('  raw_venue_items e (na ingestão real) em venues_staging, com geographic_status =');
  console.log('  \'outside_region\' (ADR-0022, coluna própria — proposal_status nunca é alterado por');
  console.log('  este gate) — nunca é perdido, apenas fica fora da fila normal de Human Review e');
  console.log('  não elegível para promoção/publicação nesta onda regional.');

  // ── Snapshot local machine-readable (Etapa 2, pedido explícito) ────────────
  //
  // CACHE OPERACIONAL, NÃO FONTE DE VERDADE — a fonte de verdade continua
  // sendo raw_venue_items (e, na ingestão real, venues_staging). Este
  // snapshot serve apenas para: comparar raios diferentes, testar novas
  // regras, e evitar repetir uma chamada paga só para reanalisar dados já
  // colhidos. Nunca é lido por nenhum script de ingestão real, nunca
  // substitui a Camada A, e pode ser apagado a qualquer momento sem perda
  // de informação — os dados oficiais continuam no banco.
  const snapshotDir = join(process.cwd(), 'dry-run-snapshots');
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotRegionSuffix = regionKey ?? 'todas-regioes';
  const snapshotPath = join(snapshotDir, `${productKey}_${snapshotRegionSuffix}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const snapshotRows = filtered.map((r) => {
    const geo = geoByResult.get(r);
    return {
      place_id: r.item.source_item_id,
      name: r.item.name,
      lat: r.item.lat,
      lng: r.item.lng,
      category: r.item.source_category_hint,
      google_types: r.item.google_types,
      decision: r.filter.decision,
      reasoning: r.filter.reasoning,
      distance_meters: geo ? Math.round(geo.distanceMeters) : null,
      geographic_bucket: geo?.bucket ?? null,
    };
  });
  writeFileSync(snapshotPath, JSON.stringify(snapshotRows, null, 2), 'utf-8');
  console.log(`\n  📄 Snapshot local guardado em: ${snapshotPath} (${snapshotRows.length} registos)`);

  console.log('\n=== ESTATÍSTICAS DA EXECUÇÃO ===');
  console.log(`Queries executadas: ${collected.stats.queries_executed}`);
  console.log(`Queries puladas por orçamento: ${collected.stats.queries_skipped_budget}`);
  console.log(`Lugares encontrados (bruto, antes de dedupe): ${collected.stats.places_found_raw}`);
  console.log(`Venues únicos retornados pela coleta: ${collected.stats.places_returned}`);
  console.log(`Custo estimado desta execução: USD ${collected.stats.estimated_cost_usd.toFixed(2)}`);
  console.log(
    '\nNenhuma escrita em staging.venues_staging, staging.activities_staging, public.venues ou public.activities foi realizada.',
  );
}

// Guarda de entry-point — main() só corre quando este ficheiro é
// executado diretamente, nunca quando importado por um teste (que só
// quer resolveDryRunArgs). Sem isto, importar este módulo num teste
// dispararia uma chamada real à API.
//
// pathToFileURL() (não comparação de string com `file://`) porque
// caminhos Windows (C:\...) não convertem para file:// URL por
// simples concatenação — ver mesma nota em ingest-google-places.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Dry-run falhou:', err);
    process.exit(1);
  });
}
