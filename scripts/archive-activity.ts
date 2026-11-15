/**
 * Retirar uma actividade publicada do app (arquivo manual) — STAGING.
 *
 * Até 15/11/2026 ActivityPublisher.archiveActivity() existia mas nenhum
 * comando a chamava: não havia forma operacional de retirar conteúdo errado
 * já publicado. Este comando fecha essa lacuna.
 *
 *   # ver o que seria arquivado (só leitura):
 *   npx tsx --env-file=<ficheiro-fora-do-repo> scripts/archive-activity.ts \
 *     --product-key=vivere-60-mais --engine-activity-id=<uuid>
 *   # arquivar de facto:
 *   ... --confirm
 *
 * O cliente Supabase passa pelo envGuard (só staging nesta fase). Regista
 * uma publication run 'manual-archive' e o evento ActivityArchived.
 */
import { fileURLToPath } from 'node:url';
import type { IPublishingRepositorySet } from '../src/publishing/repositories/interfaces.js';
import type { EngineActivityId, PublicationRunMetrics } from '../src/publishing/types/domain.js';

export interface ArchiveArgs {
  readonly productKey: string;
  readonly engineActivityId: string;
  readonly confirm: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArchiveArgs(argv: readonly string[]): ArchiveArgs {
  let productKey: string | undefined;
  let engineActivityId: string | undefined;
  let confirm = false;
  for (const a of argv) {
    if (a.startsWith('--product-key=')) productKey = a.slice('--product-key='.length);
    else if (a.startsWith('--engine-activity-id=')) engineActivityId = a.slice('--engine-activity-id='.length);
    else if (a === '--confirm') confirm = true;
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!productKey) throw new Error('--product-key é obrigatório');
  if (!engineActivityId || !UUID.test(engineActivityId)) throw new Error('--engine-activity-id tem de ser um UUID');
  return { productKey, engineActivityId, confirm };
}

export type ArchiveOutcome =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'already_archived'; readonly publicActivityId: string }
  | { readonly kind: 'would_archive'; readonly publicActivityId: string }
  | { readonly kind: 'archived'; readonly publicActivityId: string; readonly runId: string };

type Repos = Pick<IPublishingRepositorySet, 'publicActivity' | 'run' | 'event'>;
type Archiver = (engineActivityId: EngineActivityId, runId: string, productKey: string) => Promise<void>;

export async function runArchive(repos: Repos, archive: Archiver, args: ArchiveArgs, now: () => number = Date.now): Promise<ArchiveOutcome> {
  const id = args.engineActivityId as EngineActivityId;
  const state = await repos.publicActivity.findPublicationStateByEngineId(id);
  if (state === null) return { kind: 'not_found' };
  if (state.engineStatus === 'archived') return { kind: 'already_archived', publicActivityId: state.publicActivityId };
  if (!args.confirm) return { kind: 'would_archive', publicActivityId: state.publicActivityId };

  const started = now();
  const runId = await repos.run.start(args.productKey, 'manual-archive');
  try {
    await archive(id, runId, args.productKey);
  } catch (err) {
    await repos.run.markFailed(runId, err instanceof Error ? err.message : String(err));
    throw err;
  }
  const metrics: PublicationRunMetrics = {
    venuesPublished: 0, venuesUpdated: 0, venuesSkipped: 0, venuesArchived: 0,
    activitiesPublished: 0, activitiesUpdated: 0, activitiesSkipped: 0, activitiesArchived: 1,
    errors: 0, durationMs: now() - started,
  };
  await repos.run.finish(runId, metrics);
  return { kind: 'archived', publicActivityId: state.publicActivityId, runId };
}

async function main(): Promise<void> {
  const args = parseArchiveArgs(process.argv.slice(2));
  const { PublishingRepositoryFactory } = await import('../src/publishing/repositories/factory.js');
  const { ActivityPublisher } = await import('../src/publishing/services/ActivityPublisher.js');
  const repos = await PublishingRepositoryFactory.forSupabase();
  const publisher = new ActivityPublisher(repos.publishableActivity, repos.publicActivity, repos.event);
  const out = await runArchive(repos, (id, runId, pk) => publisher.archiveActivity(id, runId as never, pk), args);
  switch (out.kind) {
    case 'not_found':        console.error('Nenhuma actividade publicada com esse engine_activity_id.'); process.exit(2); break;
    case 'already_archived': console.log(`Já arquivada (public.activities ${out.publicActivityId}). Nada a fazer.`); break;
    case 'would_archive':    console.log(`Seria arquivada: public.activities ${out.publicActivityId}. Repetir com --confirm.`); break;
    case 'archived':         console.log(`Arquivada: public.activities ${out.publicActivityId} (publication run ${out.runId}).`); break;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
