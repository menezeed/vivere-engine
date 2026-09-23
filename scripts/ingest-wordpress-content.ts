/**
 * Ingestão REAL do WordPressContentCollector — escreve em banco.
 *
 * Uso:
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx \
 *   npx tsx scripts/ingest-wordpress-content.ts --instance=cabo-frio
 *
 *   npx tsx scripts/ingest-wordpress-content.ts --instance=cabo-frio --since-days=7
 *   npx tsx scripts/ingest-wordpress-content.ts --instance=sao-pedro-da-aldeia
 *
 * Level 2, 2026-09-23 — São Pedro da Aldeia Simple Enablement. Nenhuma
 * lógica de parsing/collector alterada — só o registo da instância já
 * existente (config/sao-pedro-da-aldeia.ts, WordPressContentCollector já
 * genérico, IngestionOrchestrator.runActivityIngestion já genérico — ver
 * Real Ingestion Enablement Assessment). structured_block_marker desta
 * fonte continua não confirmado — fora do âmbito desta mudança.
 */

import { WordPressApiClient } from '../src/collectors/wordpress-content/WordPressApiClient';
import { WordPressContentCollector } from '../src/collectors/wordpress-content/WordPressContentCollector';
import { CABO_FRIO_CONFIG } from '../src/collectors/wordpress-content/config/cabo-frio';
import { SAO_PEDRO_DA_ALDEIA_CONFIG } from '../src/collectors/wordpress-content/config/sao-pedro-da-aldeia';
import type { WordPressContentSourceConfig } from '../src/collectors/wordpress-content/config/WordPressContentSourceConfig';
import { IngestionOrchestrator } from '../src/persistence/orchestration/IngestionOrchestrator';
import { RepositoryFactory } from '../src/persistence/orchestration/RepositoryFactory';
import { logger } from '../src/lib/logger';

// Level 2, 2026-09-23 — exportado (era const local) para permitir teste
// automatizado da resolução de instância, sem precisar de mock de rede/
// Supabase. Menor alteração necessária para testabilidade, sem refactor.
export const AVAILABLE_INSTANCES: Record<string, WordPressContentSourceConfig> = {
  'cabo-frio': CABO_FRIO_CONFIG,
  'sao-pedro-da-aldeia': SAO_PEDRO_DA_ALDEIA_CONFIG,
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

// Level 2, 2026-09-23 — main() só corre quando o arquivo é executado
// directamente (CLI), nunca quando importado por um teste. Sem isto, o
// simples `import { AVAILABLE_INSTANCES }` de um teste dispararia a CLI
// real (Supabase incluído).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ error: String(err) }, 'ingestão falhou');
    process.exit(1);
  });
}
