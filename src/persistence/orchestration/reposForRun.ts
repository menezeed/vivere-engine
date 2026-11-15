/**
 * src/persistence/orchestration/reposForRun.ts
 *
 * Repositórios para uma execução dos scripts de ingestão.
 *
 * Em dry-run o IngestionOrchestrator não grava nem lê nada (ingestão de
 * actividades e de venues), por isso NÃO se cria cliente Supabase nem
 * repositórios: devolve-se um conjunto em que qualquer acesso falha
 * explicitamente (nunca uma escrita silenciosa). Fora de dry-run usa o
 * caminho existente, RepositoryFactory.forSupabase → getSupabaseClient →
 * envGuard (só staging; produção bloqueada).
 *
 * NÃO usar no reprocessamento (reprocess-venues-from-raw), cujo dry-run
 * LÊ raw_venue_items da BD.
 */
import type { IRepositorySet } from '../types/repositoryInterfaces';
import { RepositoryFactory } from './RepositoryFactory';

export function dryRunRepositories(): IRepositorySet {
  return new Proxy({} as IRepositorySet, {
    get: (_target, prop) => {
      // `then`/símbolos: o proxy é devolvido por uma função async e o await
      // verifica se é thenable — isso não é um acesso a repositórios.
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      throw new Error(`dry-run: acesso a repositórios não permitido (${String(prop)})`);
    },
  });
}

export async function reposForRun(
  dryRun: boolean,
  createRepos: () => Promise<IRepositorySet> = () => RepositoryFactory.forSupabase(),
): Promise<IRepositorySet> {
  return dryRun ? dryRunRepositories() : createRepos();
}
