/**
 * Reprocessa venues já persistidos em staging.raw_venue_items (Camada A)
 * — SEM nenhuma chamada à Google Places API, zero custo.
 *
 * Diferente de ingest-google-places.ts (que coleciona dados novos) e
 * dry-run-google-places.ts (que coleciona mas nunca escreve), este
 * script nunca fala com o Google — só lê o que já foi pago e
 * persistido, e corre a mesma sequência de filtro/gate/staging que a
 * ingestão real usa (IngestionOrchestrator.reprocessVenuesFromRaw,
 * que partilha stageVenues() com runVenueIngestion — Princípio 3,
 * "Um único pipeline").
 *
 * Útil para: validar uma nova versão das regras de filtro contra
 * dados já coletados; recuperar de uma falha na etapa de staging sem
 * repetir a coleta; comparar o resultado do pipeline antes/depois de
 * uma mudança, com os dados de entrada idênticos.
 *
 * Este script é deliberadamente fino — toda a lógica de negócio
 * (filtro, Regional Geographic Gate, persistência) vive no
 * IngestionOrchestrator e nos repositórios; aqui só há parsing de
 * argumentos, resolução de configuração, e orquestração de chamadas.
 *
 * Uso:
 *   npx tsx scripts/reprocess-venues-from-raw.ts --region=sp_brooklin_pilot
 *   npx tsx scripts/reprocess-venues-from-raw.ts --region=sp_brooklin_pilot --dry-run
 *
 * --region=<region_key> é OBRIGATÓRIO — ao contrário dos outros dois
 * scripts, aqui não existe "reprocessar todas as regiões numa só
 * chamada" (reprocessVenuesFromRaw recebe um único regionLabel); para
 * reprocessar várias regiões, correr o script uma vez por região.
 *
 * TESTABILIDADE: resolveReprocessArgs() é pura (sem I/O, sem
 * process.exit) e exportada — ver
 * scripts/__tests__/reprocess-venues-from-raw.test.ts. main() só
 * corre quando este arquivo é executado diretamente (guarda de
 * entry-point abaixo, pathToFileURL — nunca comparação de string com
 * `file://`, que falha no Windows).
 */

import { VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG } from '../src/collectors/google-places/config/vivere-60-mais';
import type { GooglePlacesProductConfig } from '../src/collectors/google-places/config/GooglePlacesProductConfig';
import { VIVERE_60_MAIS_VENUE_FILTER_RULES } from '../src/pipeline/stages/00-filter-venue/products/vivere-60-mais';
import { IngestionOrchestrator } from '../src/persistence/orchestration/IngestionOrchestrator';
import { RepositoryFactory } from '../src/persistence/orchestration/RepositoryFactory';
import { resolveRegionFilter } from '../src/lib/resolveRegionFilter';
import type { SourceConfigContract } from '../src/persistence/types/collectorContracts';
import { logger } from '../src/lib/logger';
import { pathToFileURL } from 'node:url';

export interface ReprocessArgsResolution {
  readonly regionKey: string;
  readonly regionLabel: string;
  readonly sourceConfig: SourceConfigContract;
  readonly dryRun: boolean;
}

export type ReprocessArgsResult =
  | { readonly ok: true; readonly result: ReprocessArgsResolution }
  | { readonly ok: false; readonly error: string; readonly available: readonly string[] };

/**
 * Resolve toda a configuração efetiva a partir de argv — pura, sem
 * I/O, sem process.exit. Reaproveita resolveRegionFilter (a mesma
 * função usada pelos outros dois scripts — Princípio 1, uma única
 * fonte de verdade) e constrói o SourceConfigContract MÍNIMO que
 * reprocessVenuesFromRaw() realmente precisa — não o
 * GooglePlacesProductConfig inteiro. Reduz o acoplamento: se
 * ProductConfig ganhar campos novos (categories, budget, etc.), este
 * script não precisa de saber, porque nunca os usa.
 */
export function resolveReprocessArgs(
  argv: readonly string[],
  baseConfig: GooglePlacesProductConfig,
): ReprocessArgsResult {
  const regionArg = argv.find((a) => a.startsWith('--region='));
  const regionKey = regionArg ? regionArg.split('=')[1] : undefined;

  if (!regionKey) {
    return {
      ok: false,
      error: '--region= é obrigatório para reprocessamento — não existe "reprocessar todas as regiões" numa só chamada',
      available: baseConfig.regions.map((r) => r.key),
    };
  }

  const regionResult = resolveRegionFilter(baseConfig, regionKey);
  if (!regionResult.ok) {
    return { ok: false, error: regionResult.error, available: regionResult.available };
  }

  const selectedRegion = regionResult.config.regions[0]!;
  const dryRun = argv.includes('--dry-run');

  const sourceConfig: SourceConfigContract = {
    source_key: baseConfig.source_key,
    product_key: baseConfig.product_key,
    regions: [selectedRegion],
  };

  return {
    ok: true,
    result: { regionKey, regionLabel: selectedRegion.display_label, sourceConfig, dryRun },
  };
}

async function main() {
  const resolution = resolveReprocessArgs(process.argv, VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG);

  if (!resolution.ok) {
    logger.error({ available: resolution.available }, `${resolution.error} — nenhuma leitura foi feita`);
    process.exit(1);
  }

  const { regionKey, regionLabel, sourceConfig, dryRun } = resolution.result;

  logger.info({ regionKey, regionLabel, dryRun }, 'iniciando reprocessamento de raw_venue_items');

  const repos = await RepositoryFactory.forSupabase();
  const orchestrator = new IngestionOrchestrator(repos);

  const startedAt = Date.now();
  const summary = await orchestrator.reprocessVenuesFromRaw(
    sourceConfig,
    VIVERE_60_MAIS_VENUE_FILTER_RULES,
    regionLabel,
    { dryRun },
  );
  const durationMs = Date.now() - startedAt;

  logger.info(
    { regionKey, regionLabel, durationMs, ...summary },
    'reprocessamento de raw_venue_items concluído',
  );

  console.log('\n=== REPROCESSAMENTO CONCLUÍDO ===');
  console.log(`Região: ${regionLabel} (${regionKey})`);
  console.log(`IngestionRun ID: ${summary.ingestionRunId ?? '(dry-run)'}`);
  console.log(`Duração: ${durationMs}ms`);
  console.log(`raw_venue_items lidos: ${summary.rawItemsCollected}`);
  console.log(`Excluídos pelo Regional Geographic Gate (ADR-0022): ${summary.geoExcludedItems}`);
  console.log(`Staged (Camada B): ${summary.stagedItems}`);
  console.log(`Rejeitados: ${summary.rejectedItems}`);
  console.log(
    '\nNenhuma chamada à Google Places API foi feita — reprocessamento a partir de dados já persistidos.',
  );
}

// Guarda de entry-point — pathToFileURL(), não comparação de string
// com `file://` (falha no Windows — ver nota em ingest-google-places.ts
// e dry-run-google-places.ts, mesma correção aplicada aqui desde a
// primeira versão).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    logger.error({ error: String(err) }, 'reprocessamento falhou');
    process.exit(1);
  });
}
