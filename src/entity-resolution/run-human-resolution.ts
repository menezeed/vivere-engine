/**
 * src/entity-resolution/run-human-resolution.ts
 *
 * Level 2, 2026-09-26 — Human Resolution.
 *
 * Script de execução do HumanResolutionService — confirmação humana de
 * um candidato de venue para uma Activity. NÃO altera proposal_status
 * — isso continua a ser feito pelo fluxo normal existente
 * (ReviewService.reviewActivity(..., 'approve', ...)), separadamente.
 *
 * Uso:
 *   npx tsx --env-file=.env src/entity-resolution/run-human-resolution.ts \
 *     --activity-id=<uuid> --candidate-venue-id=<uuid> --user-id=<id> \
 *     --notes="texto opcional"
 */

import { EntityResolutionRepositoryFactory } from './repositories/factory.js';
import { ActivityResolutionRepository } from './repositories/impl/ActivityResolutionRepository.js';
import { HumanResolutionService } from './services/HumanResolutionService.js';
import { isERError } from './errors/index.js';
import type { ActivityStagingId, VenueStagingId } from './types/domain.js';

const ACTIVITY_ID = process.argv.find(a => a.startsWith('--activity-id='))?.split('=')[1] as ActivityStagingId | undefined;
const CANDIDATE_VENUE_ID = process.argv.find(a => a.startsWith('--candidate-venue-id='))?.split('=')[1] as VenueStagingId | undefined;
const USER_ID = process.argv.find(a => a.startsWith('--user-id='))?.split('=')[1];
const notesArg = process.argv.find(a => a.startsWith('--notes='));
const NOTES = notesArg ? notesArg.slice('--notes='.length) : null;

async function main(): Promise<void> {
  console.log('=== Vivere Platform — Human Resolution ===');
  console.log(`Activity ID:         ${ACTIVITY_ID ?? '(não especificado)'}`);
  console.log(`Candidate Venue ID:  ${CANDIDATE_VENUE_ID ?? '(não especificado)'}`);
  console.log(`User ID:             ${USER_ID ?? '(não especificado)'}`);
  console.log(`Notes:               ${NOTES ?? '(nenhuma)'}`);
  console.log('');

  if (!ACTIVITY_ID || !CANDIDATE_VENUE_ID || !USER_ID) {
    console.error('Erro: especifique --activity-id, --candidate-venue-id e --user-id');
    console.error('  Exemplo: npx tsx src/entity-resolution/run-human-resolution.ts --activity-id=<uuid> --candidate-venue-id=<uuid> --user-id=<id>');
    process.exit(1);
  }

  const repos = await EntityResolutionRepositoryFactory.forSupabase();

  const { getSupabaseClient } = await import('../persistence/client/supabase.js');
  const db = getSupabaseClient();
  const activityRepo = new ActivityResolutionRepository(db);

  const service = new HumanResolutionService(activityRepo, repos.candidate, repos.decision);

  await service.accept(ACTIVITY_ID, CANDIDATE_VENUE_ID, USER_ID, NOTES);

  console.log('\nHuman Resolution confirmada com sucesso.');
}

main().catch(err => {
  console.error('Erro na Human Resolution:', err instanceof Error ? err.message : String(err));
  if (isERError(err)) {
    console.error('Código:', err.code);
    console.error('Contexto:', JSON.stringify(err.context));
  }
  process.exit(1);
});
