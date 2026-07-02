import type { IRepositorySet } from '../types/repositoryInterfaces';
import { IngestionRunRepository } from '../repositories/IngestionRunRepository';
import { RawVenueItemRepository } from '../repositories/RawVenueItemRepository';
import { RawActivityItemRepository } from '../repositories/RawActivityItemRepository';
import { VenueStagingRepository } from '../repositories/VenueStagingRepository';
import { ActivityStagingRepository } from '../repositories/ActivityStagingRepository';

/**
 * RepositoryFactory — único ponto de montagem de um IRepositorySet.
 *
 * O IngestionOrchestrator recebe um IRepositorySet e não sabe como ele
 * foi construído — a RepositoryFactory é quem sabe. Isso desacopla a
 * engine de persistência da tecnologia subjacente: Supabase hoje,
 * Postgres direto amanhã, mock em testes, SQLite em integração local.
 *
 * Métodos estáticos (não instância) porque a factory não tem estado
 * próprio — é um namespace de funções de construção.
 */
export class RepositoryFactory {
  /**
   * Monta o conjunto de repositórios para produção (e dev real),
   * usando o cliente Supabase com as credenciais do ambiente.
   * Lança se SUPABASE_URL ou SUPABASE_SERVICE_KEY não estiverem
   * definidos — falha ruidosa intencional.
   */
  static async forSupabase(): Promise<IRepositorySet> {
    const { getSupabaseClient } = await import('../client/supabase.js');
    const db = getSupabaseClient();

    return {
      ingestionRun:    new IngestionRunRepository(db),
      rawVenueItem:    new RawVenueItemRepository(db),
      rawActivityItem: new RawActivityItemRepository(db),
      venueStaging:    new VenueStagingRepository(db),
      activityStaging: new ActivityStagingRepository(db),
    };
  }

  /**
   * Monta um conjunto de repositórios a partir de um IRepositorySet
   * parcialmente fornecido, preenchendo o que falta com implementações
   * de produção (Supabase). Útil para testes de integração que querem
   * substituir só um repositório específico.
   */
  static async forSupabaseWith(overrides: Partial<IRepositorySet>): Promise<IRepositorySet> {
    const base = await RepositoryFactory.forSupabase();
    return { ...base, ...overrides };
  }

  /**
   * Monta um conjunto de repositórios completamente controlado pelo
   * chamador. Usado nos testes unitários do Orchestrator, onde cada
   * repositório é um mock do Vitest. Sem dependência de banco.
   *
   * Exemplo de uso em testes:
   *   const repos = RepositoryFactory.fromObject({
   *     ingestionRun: { start: vi.fn(), finish: vi.fn(), markFailed: vi.fn() },
   *     rawVenueItem: { insertBatch: vi.fn().mockResolvedValue([]) },
   *     // ...
   *   });
   */
  static fromObject(repos: IRepositorySet): IRepositorySet {
    return repos;
  }
}
