/**
 * scripts/ingest-targeted-venues.ts
 *
 * Ingestão direccionada de venues específicos mencionados nas
 * VenueMentions das actividades actuais da Prefeitura de Cabo Frio.
 *
 * Uso (acrescentar --budget=persistent para o orçamento persistente):
 *   npx tsx --env-file=.env scripts/ingest-targeted-venues.ts --dry-run
 *   npx tsx --env-file=.env scripts/ingest-targeted-venues.ts
 *
 * --budget=persistent (L5, migração 0026): orçamento persistente por RPC,
 * só com flag explícita; por omissão (memory) o tecto vale só para esta
 * execução. Recusado com --dry-run (o dry-run nunca cria cliente Supabase).
 */

import { GooglePlacesApiClient }          from '../src/collectors/google-places/GooglePlacesApiClient.js';
import { GooglePlacesCollector }          from '../src/collectors/google-places/GooglePlacesCollector.js';
import { BudgetGuard, budgetRepoForRun, resolveBudgetMode } from '../src/lib/budgetGuard.js';
import { TARGETED_VENUE_LOOKUP_CONFIG }   from '../src/collectors/google-places/config/targeted-venue-lookup.js';
import { VIVERE_60_MAIS_VENUE_FILTER_RULES } from '../src/pipeline/stages/00-filter-venue/products/vivere-60-mais.js';
import { IngestionOrchestrator }          from '../src/persistence/orchestration/IngestionOrchestrator.js';
import { reposForRun }                    from '../src/persistence/orchestration/reposForRun.js';
import { logger }                         from '../src/lib/logger.js';

const DRY_RUN       = process.argv.includes('--dry-run');
const COST_PER_QUERY = 0.032;
const N_QUERIES     = TARGETED_VENUE_LOOKUP_CONFIG.categories.length *
                      TARGETED_VENUE_LOOKUP_CONFIG.regions.length;

async function main() {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) {
    console.error('❌ GOOGLE_PLACES_API_KEY não definida no .env');
    process.exit(1);
  }

  console.log('=== Vivere Platform — Ingestão Direccionada de Venues ===');
  console.log(`Modo:           ${DRY_RUN ? 'DRY-RUN (sem escrita)' : 'REAL'}`);
  console.log(`Produto:        ${TARGETED_VENUE_LOOKUP_CONFIG.product_key}`);
  console.log(`Queries:        ${N_QUERIES}`);
  console.log(`Custo estimado: ~$${(N_QUERIES * COST_PER_QUERY).toFixed(2)}`);
  console.log('');
  console.log('Venues alvo:');
  TARGETED_VENUE_LOOKUP_CONFIG.categories.forEach(c =>
    console.log(`  — ${c.query_text}`),
  );
  console.log('');

  const budget = resolveBudgetMode(process.argv, DRY_RUN);
  if (!budget.ok) {
    console.error(`❌ ${budget.error} — nenhuma chamada à API foi feita`);
    process.exit(1);
  }

  const apiClient  = new GooglePlacesApiClient(apiKey);
  const budgetRepo = await budgetRepoForRun(budget.mode, {
    provider:            'google_places',
    monthly_budget_usd:  TARGETED_VENUE_LOOKUP_CONFIG.monthly_budget_usd,
    hard_stop_enabled:   TARGETED_VENUE_LOOKUP_CONFIG.hard_stop_enabled,
  });
  const budgetGuard = new BudgetGuard(budgetRepo, { mode: budget.mode });

  const collector = new GooglePlacesCollector(
    apiClient,
    budgetGuard,
    TARGETED_VENUE_LOOKUP_CONFIG,
  );

  // dry-run: sem cliente Supabase nem repositórios; modo real: forSupabase → envGuard.
  const repos       = await reposForRun(DRY_RUN);
  const orchestrator = new IngestionOrchestrator(repos);

  const summary = await orchestrator.runVenueIngestion(
    collector,
    TARGETED_VENUE_LOOKUP_CONFIG,
    VIVERE_60_MAIS_VENUE_FILTER_RULES,
    { dryRun: DRY_RUN },
  );

  console.log('\n=== Resultado ===');
  console.log(`Colectados:  ${summary.rawItemsCollected}`);
  console.log(`Aceites:     ${summary.stagedItems}`);
  console.log(`Rejeitados:  ${summary.rejectedItems}`);
  console.log(`Revisão:     ${(summary.rawItemsCollected - summary.stagedItems - summary.rejectedItems)}`);
  const cost = budgetGuard.costSummary();
  console.log(`Custo API (${cost.budget_mode}): gasto USD ${cost.totals.spent_usd.toFixed(3)}, libertado USD ${cost.totals.released_usd.toFixed(3)}, recusadas ${cost.totals.refused_count}`);

  if (DRY_RUN) {
    console.log('\n✔ Dry-run concluído — nenhum dado foi escrito.');
    console.log('  Execute sem --dry-run para iniciar a ingestão real.');
  } else {
    console.log('\n✔ Ingestão concluída.');
    console.log('');
    console.log('Próximos passos:');
    console.log('  1. Admin Panel → Venues → Pendentes → aprovar os novos venues');
    console.log('  2. Tab Aprovados → Promover todos');
    console.log('  3. npx tsx --env-file=.env src/entity-resolution/run.ts --product-key=vivere-60-mais');
  }
}

main().catch(err => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
