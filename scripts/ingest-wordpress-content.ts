/**
 * Ingestão REAL do WordPressContentCollector — escreve em banco.
 *
 * Uso:
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx \
 *   npx tsx scripts/ingest-wordpress-content.ts --instance=cabo-frio
 *
 *   npx tsx scripts/ingest-wordpress-content.ts --instance=cabo-frio --since-days=7
 */

import { WordPressApiClient } from '../src/collectors/wordpress-content/WordPressApiClient';
import { WordPressContentCollector } from '../src/collectors/wordpress-content/WordPressContentCollector';
import { CABO_FRIO_CONFIG } from '../src/collectors/wordpress-content/config/cabo-frio';
import type { WordPressContentSourceConfig } from '../src/collectors/wordpress-content/config/WordPressContentSourceConfig';
import { IngestionOrchestrator } from '../src/persistence/orchestration/IngestionOrchestrator';
import { RepositoryFactory } from '../src/persistence/orchestration/RepositoryFactory';
import { logger } from '../src/lib/logger';

const AVAILABLE_INSTANCES: Record<string, WordPressContentSourceConfig> = {
  'cabo-frio': CABO_FRIO_CONFIG,
};

async function main() {
  const instanceArg = process.argv.find((a) => a.startsWith('--instance='));
  const instanceKey = instanceArg ? instanceArg.split('=')[1] : 'cabo-frio';
  const sourceConfig = AVAILABLE_INSTANCES[instanceKey];

  if (!sourceConfig) {
    logger.error({ instanceKey, available: Object.keys(AVAILABLE_INSTANCES) }, 'instância não encontrada');
    process.exit(1);
  }

  const sinceDaysArg = process.argv.find((a) => a.startsWith('--since-days='));
  const sinceDays = sinceDaysArg ? Number(sinceDaysArg.split('=')[1]) : undefined;

  const dryRun = process.argv.includes('--dry-run');

  logger.info({ sourceKey: sourceConfig.source_key, dryRun, sinceDays }, 'iniciando script de ingestão WordPress');

  const apiClient = new WordPressApiClient(sourceConfig.base_url);
  const collector = new WordPressContentCollector(apiClient, sourceConfig);

  const repos = await RepositoryFactory.forSupabase();
  const orchestrator = new IngestionOrchestrator(repos);

  const summary = await orchestrator.runActivityIngestion(collector, sourceConfig, {
    dryRun,
    sinceDays,
  });

  console.log('\n=== INGESTÃO CONCLUÍDA ===');
  console.log(`IngestionRun ID:    ${summary.ingestionRunId ?? '(dry-run)'}`);
  console.log(`Atividades coletadas:  ${summary.rawItemsCollected}`);
  console.log(`Atividades persistidas: ${summary.rawItemsPersisted}`);
  console.log(`Erros de coleta:       ${summary.rawItemsErrored}`);
  console.log(`Staged (Camada B):     ${summary.stagedItems}`);
}

main().catch((err) => {
  logger.error({ error: String(err) }, 'ingestão falhou');
  process.exit(1);
});
