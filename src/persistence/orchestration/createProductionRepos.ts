import { getSupabaseClient } from '../client/supabase';
import { IngestionRunRepository } from '../repositories/IngestionRunRepository';
import { RawVenueItemRepository } from '../repositories/RawVenueItemRepository';
import { RawActivityItemRepository } from '../repositories/RawActivityItemRepository';
import { VenueStagingRepository } from '../repositories/VenueStagingRepository';
import { ActivityStagingRepository } from '../repositories/ActivityStagingRepository';
import type { IRepositorySet } from '../types/repositoryInterfaces';

/**
 * Monta o conjunto de repositórios usando o cliente Supabase real.
 * Ponto único de injeção de dependência para a camada de persistência.
 *
 * Chamado pelos scripts de ingestão real (ingest-*.ts).
 * Os scripts de dry-run (dry-run-*.ts) NÃO chamam esta função —
 * eles instanciam o Orchestrator sem repositórios ou com dryRun=true.
 */
export function createProductionRepos(): IRepositorySet {
  const db = getSupabaseClient();
  return {
    ingestionRun:    new IngestionRunRepository(db),
    rawVenueItem:    new RawVenueItemRepository(db),
    rawActivityItem: new RawActivityItemRepository(db),
    venueStaging:    new VenueStagingRepository(db),
    activityStaging: new ActivityStagingRepository(db),
  };
}
