/**
 * scripts/ingest-targeted-venues.ts
 *
 * Ingestão direccionada de venues específicos mencionados nas
 * VenueMentions das actividades actuais da Prefeitura de Cabo Frio.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/ingest-targeted-venues.ts --dry-run
 *   npx tsx --env-file=.env scripts/ingest-targeted-venues.ts
 */

import { GooglePlacesApiClient }          from '../src/collectors/google-places/GooglePlacesApiClient.js';
import { GooglePlacesCollector }          from '../src/collectors/google-places/GooglePlacesCollector.js';
import { InMemoryBudgetRepo }             from '../src/lib/budgetGuard.js';
import { TARGETED_VENUE_LOOKUP_CONFIG }   from '../src/collectors/google-places/config/targeted-venue-lookup.js';
import { VIVERE_60_MAIS_VENUE_FILTER_RULES } from '../src/pipeline/stages/00-filter-venue/products/vivere-60-mais.js';
import { IngestionOrchestrator }          from '../src/persistence/orchestration/IngestionOrchestrator.js';
import { RepositoryFactory }              from '../src/persistence/orchestration/RepositoryFactory.js';
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

  const apiClient  = new GooglePlacesApiClient(apiKey);
  const budgetRepo = new InMemoryBudgetRepo({
    provider:            'google_places',
    monthly_budget_usd:  TARGETED_VENUE_LOOKUP_CONFIG.monthly_budget_usd,
    hard_stop_enabled:   TARGETED_VENUE_LOOKUP_CONFIG.hard_stop_enabled,
    alert_threshold_pct: TARGETED_VENUE_LOOKUP_CONFIG.alert_threshold_pct,
  });

  const collector = new GooglePlacesCollector(
    apiClient,
    budgetRepo,
    TARGETED_VENUE_LOOKUP_CONFIG,
  );

  const repos       = await RepositoryFactory.forSupabase();
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
  console.log(`Custo real:  ~$${(N_QUERIES * COST_PER_QUERY).toFixed(3)}`);

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
