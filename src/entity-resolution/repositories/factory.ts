/**
 * entity-resolution/repositories/factory.ts
 *
 * EntityResolutionRepositoryFactory — único ponto de montagem
 * do IEntityResolutionRepositorySet.
 *
 * Segue exactamente o padrão do RepositoryFactory em
 * src/persistence/orchestration/RepositoryFactory.ts:
 * — Métodos estáticos (sem estado próprio)
 * — forSupabase() para produção
 * — fromObject() para testes (mocks totais)
 *
 * O EntityResolutionEngine importa apenas IEntityResolutionRepositorySet —
 * nunca esta factory directamente. A factory é chamada no startup
 * (server.ts ou script de linha de comandos).
 *
 * NOTA: as implementações concretas (VenueResolutionRunRepository, etc.)
 * são criadas na Sprint 7.4. Por agora, forSupabase() é um placeholder
 * que falha com mensagem clara — falha ruidosa intencional.
 */

import type { IEntityResolutionRepositorySet } from './interfaces.js';

export class EntityResolutionRepositoryFactory {
  /**
   * Monta o conjunto de repositórios para produção (Supabase).
   * Implementação concreta criada na Sprint 7.4.
   */
  static async forSupabase(): Promise<IEntityResolutionRepositorySet> {
    // Sprint 7.4: importar e instanciar as classes concretas aqui
    // Por agora, importação dinâmica garante que o erro aparece apenas
    // quando forSupabase() é chamado — não em import time.
    const { getSupabaseClient } = await import('../../persistence/client/supabase.js');
    const _db = getSupabaseClient(); // eslint-disable-line @typescript-eslint/no-unused-vars

    throw new Error(
      'EntityResolutionRepositoryFactory.forSupabase() não está implementado ainda. ' +
      'As implementações concretas são criadas na Sprint 7.4. ' +
      'Para testes, use EntityResolutionRepositoryFactory.fromObject() com mocks.',
    );
  }

  /**
   * Monta um conjunto de repositórios a partir de um objecto controlado.
   * Usado nos testes unitários do EntityResolutionEngine onde cada
   * repositório é um mock do Vitest.
   *
   * Exemplo de uso em testes:
   *   const repos = EntityResolutionRepositoryFactory.fromObject({
   *     run:       { start: vi.fn(), finish: vi.fn(), markFailed: vi.fn(), findActive: vi.fn() },
   *     candidate: { insertCandidates: vi.fn(), findByActivity: vi.fn(), setOutcome: vi.fn(), findEligibleVenues: vi.fn() },
   *     decision:  { record: vi.fn(), findLatest: vi.fn(), findPendingReview: vi.fn() },
   *   });
   */
  static fromObject(repos: IEntityResolutionRepositorySet): IEntityResolutionRepositorySet {
    return repos;
  }

  /**
   * Monta um conjunto parcialmente controlado — útil para testes de integração
   * que querem substituir apenas um repositório específico.
   */
  static async forSupabaseWith(
    overrides: Partial<IEntityResolutionRepositorySet>,
  ): Promise<IEntityResolutionRepositorySet> {
    const base = await EntityResolutionRepositoryFactory.forSupabase();
    return { ...base, ...overrides };
  }
}
