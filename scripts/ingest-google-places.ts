/**
 * Ingestão REAL do GooglePlacesCollector — escreve em banco.
 *
 * Diferente do dry-run-google-places.ts (que imprime detalhes e nunca
 * escreve), este script persiste dados reais em staging.* via
 * IngestionOrchestrator. Use com cautela em dev; nunca direto em prod
 * sem ter aplicado as três migrations.
 *
 * Pré-requisitos:
 *   1. Migrations 0001, 0002, 0003 aplicadas no banco alvo
 *   2. Produto e source cadastrados em public.products e public.sources
 *   3. SUPABASE_URL e SUPABASE_SERVICE_KEY definidos no ambiente
 *
 * Uso:
 *   GOOGLE_PLACES_API_KEY=xxx SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx \
 *   npx tsx scripts/ingest-google-places.ts
 *
 *   # Limitar queries para validação inicial em dev:
 *   npx tsx scripts/ingest-google-places.ts --limit=2
 */

import { GooglePlacesApiClient } from '../src/collectors/google-places/GooglePlacesApiClient';
import { GooglePlacesCollector } from '../src/collectors/google-places/GooglePlacesCollector';
import { InMemoryBudgetRepo } from '../src/lib/budgetGuard';
import { VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG } from '../src/collectors/google-places/config/vivere-60-mais';
import { VIVERE_60_MAIS_VENUE_FILTER_RULES } from '../src/pipeline/stages/00-filter-venue/products/vivere-60-mais';
import { IngestionOrchestrator } from '../src/persistence/orchestration/IngestionOrchestrator';
import { RepositoryFactory } from '../src/persistence/orchestration/RepositoryFactory';
import { logger } from '../src/lib/logger';

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    logger.error('GOOGLE_PLACES_API_KEY não definida');
    process.exit(1);
  }

  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limitQueries = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  const dryRun = process.argv.includes('--dry-run');

  logger.info({ dryRun, limitQueries, product: 'vivere-60-mais' }, 'iniciando script de ingestão Google Places');

  const apiClient = new GooglePlacesApiClient(apiKey);
  const budgetRepo = new InMemoryBudgetRepo({
    provider: 'google_places',
    monthly_budget_usd: VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG.monthly_budget_usd,
    hard_stop_enabled: VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG.hard_stop_enabled,
    alert_threshold_pct: VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG.alert_threshold_pct,
  });
  const collector = new GooglePlacesCollector(apiClient, budgetRepo, VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG);

  const repos = await RepositoryFactory.forSupabase();
  const orchestrator = new IngestionOrchestrator(repos);

  const summary = await orchestrator.runVenueIngestion(
    collector,
    VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG, // implementa SourceConfigContract (source_key + product_key)
    VIVERE_60_MAIS_VENUE_FILTER_RULES,
    { dryRun, limitQueries },
  );

  console.log('\n=== INGESTÃO CONCLUÍDA ===');
  console.log(`IngestionRun ID: ${summary.ingestionRunId ?? '(dry-run)'}`);
  console.log(`Venues coletados:  ${summary.rawItemsCollected}`);
  console.log(`Venues persistidos: ${summary.rawItemsPersisted}`);
  console.log(`Erros de coleta:   ${summary.rawItemsErrored}`);
  console.log(`Staged (Camada B): ${summary.stagedItems}`);
  console.log(`Rejeitados:        ${summary.rejectedItems}`);
}

main().catch((err) => {
  logger.error({ error: String(err) }, 'ingestão falhou');
  process.exit(1);
});
