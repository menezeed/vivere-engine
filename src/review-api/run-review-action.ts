/**
 * src/review-api/run-review-action.ts
 *
 * Level 2, 2026-09-26 — Human Resolution / Activity approval.
 *
 * Script de execução do ReviewService — aplica uma acção de revisão
 * (approve/reject/promote) a uma Activity, pelo fluxo real existente.
 * Nenhum novo endpoint HTTP, nenhuma UPDATE manual — só instancia as
 * classes reais já existentes (ReviewService, ActivityReviewRepository,
 * VenueReviewRepository) e chama reviewActivity().
 *
 * Uso:
 *   npx tsx --env-file=.env src/review-api/run-review-action.ts \
 *     --activity-id=<uuid> --action=approve \
 *     --user-id=<id> --user-email=<email> --user-role=admin
 */

import { ReviewService } from './services/ReviewService.js';
import { ActivityReviewRepository } from './repositories/ActivityReviewRepository.js';
import { VenueReviewRepository } from './repositories/VenueReviewRepository.js';
import type { AuthUser, ReviewAction } from './types/reviewTypes.js';

const ACTIVITY_ID = process.argv.find(a => a.startsWith('--activity-id='))?.split('=')[1];
const ACTION = process.argv.find(a => a.startsWith('--action='))?.split('=')[1] as ReviewAction | undefined;
const USER_ID = process.argv.find(a => a.startsWith('--user-id='))?.split('=')[1];
const USER_EMAIL = process.argv.find(a => a.startsWith('--user-email='))?.split('=')[1];
const USER_ROLE = process.argv.find(a => a.startsWith('--user-role='))?.split('=')[1] as AuthUser['role'] | undefined;

async function main(): Promise<void> {
  console.log('=== Vivere Platform — Review Action ===');
  console.log(`Activity ID: ${ACTIVITY_ID ?? '(não especificado)'}`);
  console.log(`Action:      ${ACTION ?? '(não especificado)'}`);
  console.log(`User:        ${USER_ID ?? '(não especificado)'} <${USER_EMAIL ?? '?'}> role=${USER_ROLE ?? '?'}`);
  console.log('');

  if (!ACTIVITY_ID || !ACTION || !USER_ID || !USER_EMAIL || !USER_ROLE) {
    console.error('Erro: especifique --activity-id, --action, --user-id, --user-email e --user-role');
    console.error('  Exemplo: npx tsx src/review-api/run-review-action.ts --activity-id=<uuid> --action=approve --user-id=<id> --user-email=<email> --user-role=admin');
    process.exit(1);
  }

  const { getSupabaseClient } = await import('../persistence/client/supabase.js');
  const db = getSupabaseClient();

  const venueRepo = new VenueReviewRepository(db);
  const activityRepo = new ActivityReviewRepository(db);
  const service = new ReviewService(venueRepo, activityRepo);

  const user: AuthUser = { id: USER_ID, email: USER_EMAIL, role: USER_ROLE };

  await service.reviewActivity(ACTIVITY_ID, ACTION, user);

  console.log(`\nActivity ${ACTIVITY_ID} — acção '${ACTION}' aplicada com sucesso.`);
}

main().catch(err => {
  console.error('Erro na acção de revisão:', err instanceof Error ? err.message : String(err));
  if (err && typeof err === 'object' && 'statusCode' in err) {
    console.error('Status code:', (err as { statusCode: unknown }).statusCode);
  }
  process.exit(1);
});
