/**
 * entity-resolution/repositories/factory.ts
 *
 * EntityResolutionRepositoryFactory — único ponto de montagem
 * do IEntityResolutionRepositorySet.
 *
 * Segue exactamente o padrão do RepositoryFactory existente:
 * — forSupabase() para produção
 * — fromObject() para testes com mocks totais
 * — forSupabaseWith() para testes de integração com override parcial
 */

import type { IEntityResolutionRepositorySet } from './interfaces.js';
import { VenueResolutionRunRepository }       from './impl/VenueResolutionRunRepository.js';
import { VenueResolutionCandidateRepository } from './impl/VenueResolutionCandidateRepository.js';
import { VenueResolutionDecisionRepository }  from './impl/VenueResolutionDecisionRepository.js';

export class EntityResolutionRepositoryFactory {
  /**
   * Monta o conjunto de repositórios para produção (Supabase).
   * Requer SUPABASE_URL e SUPABASE_SERVICE_KEY no ambiente.
   */
  static async forSupabase(): Promise<IEntityResolutionRepositorySet> {
    const { getSupabaseClient } = await import('../../persistence/client/supabase.js');
    const db = getSupabaseClient();

    return {
      run:       new VenueResolutionRunRepository(db),
      candidate: new VenueResolutionCandidateRepository(db),
      decision:  new VenueResolutionDecisionRepository(db),
    };
  }

  /**
   * Monta um conjunto de repositórios a partir de mocks.
   * Usado nos testes unitários e de contrato.
   *
   * Exemplo:
   *   const repos = EntityResolutionRepositoryFactory.fromObject({
   *     run:       createRunRepoMock(),
   *     candidate: createCandidateRepoMock(),
   *     decision:  createDecisionRepoMock(),
   *   });
   */
  static fromObject(repos: IEntityResolutionRepositorySet): IEntityResolutionRepositorySet {
    return repos;
  }

  /**
   * Monta com Supabase real mas permite sobrepor repositórios individuais.
   * Útil para testes de integração que isolam um repositório específico.
   */
  static async forSupabaseWith(
    overrides: Partial<IEntityResolutionRepositorySet>,
  ): Promise<IEntityResolutionRepositorySet> {
    const base = await EntityResolutionRepositoryFactory.forSupabase();
    return { ...base, ...overrides };
  }
}
