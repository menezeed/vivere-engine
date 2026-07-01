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
 *   GOOGLE_PLACES_API_KEY=xxx npx tsx scripts/dry-run-google-places.ts --limit=2   (só as 2 primeiras queries, para teste rápido)
 */

import { GooglePlacesApiClient } from '../src/collectors/google-places/GooglePlacesApiClient';
import { GooglePlacesCollector } from '../src/collectors/google-places/GooglePlacesCollector';
import { InMemoryBudgetRepo } from '../src/lib/budgetGuard';
import { VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG } from '../src/collectors/google-places/config/vivere-60-mais';
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

const AVAILABLE_PRODUCTS: Record<string, GooglePlacesProductConfig> = {
  'vivere-60-mais': VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG,
};

const VENUE_FILTER_RESOLVED = resolveRuleSet(VIVERE_60_MAIS_VENUE_FILTER_RULES);

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

function printItem(r: FilteredVenueItem<VivereSessentaMaisRuleId, VivereSessentaMaisAmbiguityLabel>) {
  const { item, filter } = r;
  const alternates = (item.raw_payload._alternate_category_hints as string[] | undefined) ?? [];
  console.log(`  • [${DECISION_LABEL[filter.decision] ?? filter.decision.toUpperCase()}] ${item.name}`);
  console.log(`    motivo do filtro: ${filter.reasoning}`);
  console.log(`    endereço: ${item.address ?? '(sem endereço)'}`);
  console.log(`    telefone: ${item.phone ?? '(não disponível)'}  ·  site: ${item.website ?? '(não disponível)'}`);
  console.log(`    google_types: ${item.google_types.join(', ') || '(nenhum)'}`);
  console.log(`    tipo de query: ${item.source_query_kind} ("${item.source_query_text}")`);
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

  const productArg = process.argv.find((a) => a.startsWith('--product='));
  const productKey = productArg ? productArg.split('=')[1] : 'vivere-60-mais';
  const productConfig = AVAILABLE_PRODUCTS[productKey];

  if (!productConfig) {
    console.error(`Produto "${productKey}" não encontrado. Disponíveis: ${Object.keys(AVAILABLE_PRODUCTS).join(', ')}`);
    process.exit(1);
  }

  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limitQueries = limitArg ? Number(limitArg.split('=')[1]) : undefined;

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
      printItem(r);
    }
  }

  if (collected.errors.length > 0) {
    console.log('\n=== ITENS DESCARTADOS NA COLETA (antes do filtro) ===\n');
    for (const err of collected.errors) {
      console.log(`  - ${err.message}${err.source_item_id ? ` (place_id: ${err.source_item_id})` : ''}`);
    }
  }

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

main().catch((err) => {
  console.error('Dry-run falhou:', err);
  process.exit(1);
});
