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
 *
 *   # Restringir a uma única região do produto (por region.key):
 *   npx tsx scripts/ingest-google-places.ts --region=sp_brooklin_pilot
 *
 *   # Orçamento persistente (L5, migração 0026; só com flag explícita):
 *   npx tsx scripts/ingest-google-places.ts --budget=persistent
 *   Por omissão (--budget=memory) o orçamento vive só nesta execução.
 *   --budget=persistent é recusado com --dry-run (o dry-run nunca cria
 *   cliente Supabase).
 *
 * --region=<region_key> é OBRIGATÓRIO recomendar sempre que o objectivo
 * for uma única região — sem ele, a ingestão real corre TODAS as
 * regiões configuradas para o produto (custo multiplicado). Genérico
 * para qualquer region_key existente ou futura — a lógica de resolução
 * está em src/lib/resolveRegionFilter.ts, PARTILHADA com
 * dry-run-google-places.ts. Antes desta extração (Fase 9), a mesma
 * regra estava duplicada nos dois scripts; quando um foi corrigido, o
 * outro ficou para trás — bug real, custo real. Esta partilha elimina
 * essa classe de erro estruturalmente.
 *
 * TESTABILIDADE: resolveIngestArgs() é pura (sem I/O, sem
 * process.exit) e exportada — ver
 * scripts/__tests__/ingest-google-places.test.ts. main() só corre
 * quando este arquivo é executado diretamente (guarda de entry-point
 * abaixo), nunca quando importado por um teste.
 */

import { GooglePlacesApiClient } from '../src/collectors/google-places/GooglePlacesApiClient';
import { GooglePlacesCollector } from '../src/collectors/google-places/GooglePlacesCollector';
import { BudgetGuard, budgetRepoForRun, resolveBudgetMode, type BudgetMode } from '../src/lib/budgetGuard';
import { VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG } from '../src/collectors/google-places/config/vivere-60-mais';
import { VIVERE_60_MAIS_VENUE_FILTER_RULES } from '../src/pipeline/stages/00-filter-venue/products/vivere-60-mais';
import { IngestionOrchestrator } from '../src/persistence/orchestration/IngestionOrchestrator';
import { reposForRun } from '../src/persistence/orchestration/reposForRun';
import { logger } from '../src/lib/logger';
import { resolveRegionFilter } from '../src/lib/resolveRegionFilter';
import type { GooglePlacesProductConfig } from '../src/collectors/google-places/config/GooglePlacesProductConfig';
import { pathToFileURL } from 'node:url';

export interface IngestArgsResolution {
  readonly dryRun: boolean;
  readonly limitQueries: number | undefined;
  readonly productConfig: GooglePlacesProductConfig;
  readonly regionKey: string | undefined;
  readonly budgetMode: BudgetMode;
}

export type IngestArgsResult =
  | { readonly ok: true; readonly result: IngestArgsResolution }
  | { readonly ok: false; readonly error: string; readonly available: readonly string[] };

/**
 * Resolve toda a configuração efetiva a partir de argv — pura, sem
 * I/O, sem process.exit, sem chamar nenhuma API. É exatamente aqui
 * que os dois bugs reais desta sessão aconteceram (region_key não
 * chegando a filtrar productConfig.regions); isolar esta função é o
 * que torna esse caminho testável sem gastar dinheiro real.
 */
export function resolveIngestArgs(argv: readonly string[], baseConfig: GooglePlacesProductConfig): IngestArgsResult {
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limitQueries = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  const dryRun = argv.includes('--dry-run');

  const regionArg = argv.find((a) => a.startsWith('--region='));
  const regionKey = regionArg ? regionArg.split('=')[1] : undefined;

  const budget = resolveBudgetMode(argv, dryRun);
  if (!budget.ok) {
    return { ok: false, error: budget.error, available: [] };
  }

  const regionResult = resolveRegionFilter(baseConfig, regionKey);
  if (!regionResult.ok) {
    return { ok: false, error: regionResult.error, available: regionResult.available };
  }

  return {
    ok: true,
    result: { dryRun, limitQueries, productConfig: regionResult.config, regionKey, budgetMode: budget.mode },
  };
}

export async function main(argv: readonly string[] = process.argv) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    logger.error('GOOGLE_PLACES_API_KEY não definida');
    process.exit(1);
  }

  const resolution = resolveIngestArgs(argv, VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG);

  if (!resolution.ok) {
    logger.error(
      { available: resolution.available },
      `${resolution.error} — nenhuma chamada à API foi feita`,
    );
    process.exit(1);
  }

  const { dryRun, limitQueries, productConfig, regionKey, budgetMode } = resolution.result;

  if (!regionKey) {
    logger.warn(
      { available: productConfig.regions.map((r) => r.key) },
      'nenhum --region= informado — esta execução vai processar TODAS as regiões do produto (custo multiplicado)',
    );
  }

  logger.info(
    { dryRun, limitQueries, budgetMode, product: 'vivere-60-mais', regions: productConfig.regions.map((r) => r.key) },
    'iniciando script de ingestão Google Places',
  );

  const apiClient = new GooglePlacesApiClient(apiKey);
  // memory (omissão): tecto só desta execução. persistent: RPC da 0026 pelo
  // cliente único (getSupabaseClient → envGuard); sem config → recusa tudo.
  const budgetRepo = await budgetRepoForRun(budgetMode, {
    provider: 'google_places',
    monthly_budget_usd: productConfig.monthly_budget_usd,
    hard_stop_enabled: productConfig.hard_stop_enabled,
  });
  const budgetGuard = new BudgetGuard(budgetRepo, { mode: budgetMode });
  const collector = new GooglePlacesCollector(apiClient, budgetGuard, productConfig);

  // dry-run: sem cliente Supabase nem repositórios; modo real: forSupabase → envGuard.
  const repos = await reposForRun(dryRun);
  const orchestrator = new IngestionOrchestrator(repos);

  const startedAt = Date.now();
  const summary = await orchestrator.runVenueIngestion(
    collector,
    productConfig, // implementa SourceConfigContract (source_key + product_key + regions, já filtrado acima)
    VIVERE_60_MAIS_VENUE_FILTER_RULES,
    { dryRun, limitQueries },
  );
  const durationMs = Date.now() - startedAt;

  console.log('\n=== INGESTÃO CONCLUÍDA ===');
  console.log(`IngestionRun ID: ${summary.ingestionRunId ?? '(dry-run)'}`);
  console.log(`Duração: ${durationMs}ms`);
  console.log(`Venues coletados:  ${summary.rawItemsCollected}`);
  console.log(`Venues persistidos: ${summary.rawItemsPersisted}`);
  console.log(`Erros de coleta:   ${summary.rawItemsErrored}`);
  console.log(`Excluídos pelo Regional Geographic Gate (ADR-0022): ${summary.geoExcludedItems}`);
  console.log(`Staged (Camada B): ${summary.stagedItems}`);
  console.log(`Rejeitados:        ${summary.rejectedItems}`);

  const cost = budgetGuard.costSummary();
  logger.info({ apiCost: cost }, 'custo de API da execução');
  console.log(`Custo API (${cost.budget_mode}): gasto USD ${cost.totals.spent_usd.toFixed(3)}, libertado USD ${cost.totals.released_usd.toFixed(3)}, pendente USD ${cost.totals.pending_usd.toFixed(3)}, recusadas ${cost.totals.refused_count}`);
}

// Guarda de entry-point — main() só corre quando este ficheiro é
// executado diretamente (`npx tsx scripts/ingest-google-places.ts`),
// nunca quando é importado por um teste (que só quer
// resolveIngestArgs). Sem isto, importar este módulo num teste
// dispararia uma chamada real à API.
//
// pathToFileURL() (não comparação de string com `file://`) porque
// caminhos Windows (C:\...) não convertem para file:// URL por
// simples concatenação — precisa da conversão correta do módulo
// node:url, ou a comparação falha sempre no Windows e main() nunca
// corre nem quando invocado diretamente via `npx tsx`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    logger.error({ error: String(err) }, 'ingestão falhou');
    process.exit(1);
  });
}
