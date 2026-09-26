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
 * Level 2, 2026-09-26 — AVAILABLE_INSTANCES extraído para
 * src/collectors/wordpress-content/config/registry.ts — única fonte
 * de verdade, também reutilizada pelo Entity Resolution
 * (WordPressSourceTerritorialContextProvider). Este script agora só
 * importa o registry, não o define — comportamento da CLI inalterado.
 */

import { fileURLToPath } from 'node:url';
import { WordPressApiClient } from '../src/collectors/wordpress-content/WordPressApiClient';
import { WordPressContentCollector } from '../src/collectors/wordpress-content/WordPressContentCollector';
import { AVAILABLE_INSTANCES } from '../src/collectors/wordpress-content/config/registry';
import { IngestionOrchestrator } from '../src/persistence/orchestration/IngestionOrchestrator';
import { RepositoryFactory } from '../src/persistence/orchestration/RepositoryFactory';
import { logger } from '../src/lib/logger';

export { AVAILABLE_INSTANCES };

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

// Level 2, 2026-09-24 — main() só corre quando o arquivo é executado
// directamente (CLI), nunca quando importado por um teste. Sem isto, o
// simples `import { AVAILABLE_INSTANCES }` de um teste dispararia a CLI
// real (Supabase incluído).
//
// Level 1 bugfix, 2026-09-24 — regressão confirmada em produção real
// (Windows). A comparação directa de strings
// `import.meta.url === \`file://${process.argv[1]}\`` falha
// silenciosamente: import.meta.url usa barras normais e URL encoding
// (`file:///C:/app/...`), enquanto process.argv[1] usa barras invertidas
// nativas do SO (`C:\app\...`) — as duas strings nunca batem, main()
// nunca corria, exit code 0, nenhum erro visível, nenhuma ingestão
// acontecia. fileURLToPath() normaliza import.meta.url para o formato de
// caminho nativo do SO antes de comparar — portátil, sem lógica
// condicional por plataforma.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    logger.error({ error: String(err) }, 'ingestão falhou');
    process.exit(1);
  });
}
