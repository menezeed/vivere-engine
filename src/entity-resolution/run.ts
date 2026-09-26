/**
 * src/entity-resolution/run.ts
 *
 * Script de execução do Entity Resolution Engine.
 *
 * Uso:
 *   npx tsx --env-file=.env src/entity-resolution/run.ts --product-key=vivere-60-mais
 *   npx tsx --env-file=.env src/entity-resolution/run.ts --product-key=vivere-60-mais --dry-run
 *   npx tsx --env-file=.env src/entity-resolution/run.ts --activity-id=<uuid>
 *
 * Level 2, 2026-09-26 — WordPressSourceTerritorialContextProvider
 * injectado explicitamente, ligando o contexto territorial confiável
 * (region_metadata das fontes WordPress) ao pipeline real. Sem esta
 * ligação, o Engine usaria o provider nulo por omissão (mesmo
 * comportamento de antes desta correcção — nenhum contexto
 * territorial, nenhum filtro de cidade).
 */

import { EntityResolutionEngine }      from './EntityResolutionEngine.js';
import { EntityResolutionRepositoryFactory } from './repositories/factory.js';
import { ActivityResolutionRepository } from './repositories/impl/ActivityResolutionRepository.js';
import { WordPressSourceTerritorialContextProvider } from './pipeline/WordPressSourceTerritorialContextProvider.js';
import { NameMatcher }                 from './matchers/NameMatcher.js';
import { GeoMatcher }                  from './matchers/GeoMatcher.js';
import { AddressMatcher }              from './matchers/AddressMatcher.js';
import { ERLogger }                    from './utils/logging.js';
import { DEFAULT_ER_CONFIG }           from './config/index.js';
import type { ActivityStagingId }      from './types/domain.js';

const DRY_RUN    = process.argv.includes('--dry-run');
const PRODUCT_KEY = process.argv.find(a => a.startsWith('--product-key='))?.split('=')[1];
const ACTIVITY_ID = process.argv.find(a => a.startsWith('--activity-id='))?.split('=')[1] as ActivityStagingId | undefined;

function log(msg: string, data?: unknown): void {
  const prefix = DRY_RUN ? '[DRY-RUN] ' : '';
  console.log(`${prefix}${msg}`, data ? JSON.stringify(data, null, 2) : '');
}

async function main(): Promise<void> {
  console.log('=== Vivere Platform — Entity Resolution Engine ===');
  console.log(`Modo:        ${DRY_RUN ? 'DRY-RUN (sem escrita)' : 'REAL'}`);
  console.log(`Product key: ${PRODUCT_KEY ?? '(não especificado)'}`);
  console.log(`Activity ID: ${ACTIVITY_ID ?? '(todos unresolved)'}`);
  console.log('');

  if (!PRODUCT_KEY && !ACTIVITY_ID) {
    console.error('Erro: especifique --product-key ou --activity-id');
    console.error('  Exemplo: npx tsx src/entity-resolution/run.ts --product-key=vivere-60-mais --dry-run');
    process.exit(1);
  }

  if (DRY_RUN) {
    log('Verificando configuração...');
    log('SUPABASE_URL',         process.env['SUPABASE_URL']         ? 'OK' : 'ausente');
    log('SUPABASE_SERVICE_KEY', process.env['SUPABASE_SERVICE_KEY'] ? 'OK' : 'ausente');
    log('');
    log('Dry-run concluído. Execute sem --dry-run para resolver venues.');
    return;
  }

  // Montar dependências
  const repos = await EntityResolutionRepositoryFactory.forSupabase();

  const { getSupabaseClient } = await import('../persistence/client/supabase.js');
  const db = getSupabaseClient();
  const activityRepo = new ActivityResolutionRepository(db);

  const matchers = [
    new NameMatcher(),
    new GeoMatcher(),
    new AddressMatcher(),
  ];

  // Level 2, 2026-09-26 — provider territorial real, ligando
  // region_metadata das fontes WordPress ao CandidatePreFilter.
  const territorialContextProvider = new WordPressSourceTerritorialContextProvider();

  const engine = new EntityResolutionEngine(
    repos,
    activityRepo,
    matchers,
    ERLogger,
    DEFAULT_ER_CONFIG,
    territorialContextProvider,
  );

  // Resolver actividade específica
  if (ACTIVITY_ID) {
    log(`Resolvendo actividade: ${ACTIVITY_ID}`);
    const result = await engine.resolve(ACTIVITY_ID);
    console.log('\nResultado:');
    console.log(`  kind:           ${result.kind}`);
    if (result.kind !== 'failed' && result.result) {
      const r = result.result;
      console.log(`  classification: ${r.classification}`);
      console.log(`  candidatesIn:   ${r.candidatesInPool}`);
      console.log(`  candidatesOut:  ${r.allCandidates.length}`);
      console.log(`  processingMs:   ${r.processingMs}ms`);
      if (r.topCandidate) {
        console.log(`  topCandidate:   ${r.topCandidate.candidate.name} (score: ${r.topCandidate.score.finalScore.toFixed(3)})`);
      }
    }
    return;
  }

  // Resolver todas as actividades do produto
  if (PRODUCT_KEY) {
    log(`Iniciando resolução para produto: ${PRODUCT_KEY}`);
    const batchResult = await engine.resolveAll(PRODUCT_KEY);

    console.log('\n=== Resultado da Run ===');
    console.log(`  Total:      ${batchResult.summary.total}`);
    console.log(`  Succeeded:  ${batchResult.summary.succeeded}`);
    console.log(`  Partial:    ${batchResult.summary.partial}`);
    console.log(`  Unresolved: ${batchResult.summary.unresolved}`);
    console.log(`  Failed:     ${batchResult.summary.failed}`);
    console.log(`  Duration:   ${batchResult.summary.durationMs}ms`);

    if (batchResult.summary.failed > 0) {
      console.warn('\nAlgumas actividades falharam. Verificar logs.');
      process.exit(1);
    }

    console.log('\nEntity Resolution concluído com sucesso.');
  }
}

main().catch(err => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
