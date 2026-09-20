import type { RawVenueItem } from '../../types/RawVenueItem';
import type { RawActivityItem } from '../../types/RawActivityItem';
import type { PersistedRawVenueItem, PersistedRawActivityItem } from './persistenceTypes';
import type { FilteredVenueItem } from '../../pipeline/stages/00-filter-venue/index';
import type {
  ReviewFilter,
  ReviewContext,
  VenueStagingRow,
  ActivityStagingRow,
} from '../../review-api/types/reviewTypes';

/**
 * Interfaces de repositório que o IngestionOrchestrator depende.
 * As classes concretas (IngestionRunRepository, etc.) implementam
 * estas interfaces — o Orchestrator importa apenas os tipos, nunca
 * as classes.
 *
 * Isso permite que a RepositoryFactory retorne mocks, stubs, ou
 * implementações alternativas (Postgres direto, SQLite em testes de
 * integração, DynamoDB no futuro) sem alterar nenhuma linha do
 * Orchestrator.
 */

export interface IIngestionRunRepository {
  start(sourceKey: string): Promise<string>;
  finish(runId: string, stats: { itemsCollected: number; itemsErrored: number }): Promise<void>;
  markFailed(runId: string, reason: string): Promise<void>;
}

export interface IRawVenueItemRepository {
  insertBatch(items: RawVenueItem[], ingestionRunId: string): Promise<PersistedRawVenueItem[]>;
  /**
   * Leitura da Camada A por source_key + source_region_label — NUNCA
   * por product_key, que não existe em raw_venue_items (só a partir
   * de venues_staging). Usado pelo reprocessamento
   * (IngestionOrchestrator.reprocessVenuesFromRaw) para reaproveitar
   * dados já coletados e pagos, sem nova chamada à fonte externa.
   * Devolve o item reconstruído junto com o {id, source_item_id} já
   * persistido — nunca passa por insertBatch/upsert, que devolveria
   * lista vazia para linhas já existentes (ON CONFLICT DO NOTHING).
   *
   * Opcional: nem todo repositório/mock precisa desta capacidade —
   * mesmo padrão de SourceConfigContract.regions (opcional). Testes
   * que só exercitam runVenueIngestion continuam válidos sem
   * implementar isto.
   */
  findByRegionLabel?(
    sourceKey: string,
    regionLabel: string,
  ): Promise<{ item: RawVenueItem; persisted: PersistedRawVenueItem }[]>;
}

export interface IRawActivityItemRepository {
  insertBatch(items: RawActivityItem[], ingestionRunId: string): Promise<PersistedRawActivityItem[]>;
}

export interface IVenueStagingRepository {
  insertBatch(
    filteredItems: FilteredVenueItem<string, string>[],
    persistedRaw: PersistedRawVenueItem[],
    productKey: string,
  ): Promise<number>;
}

export interface IActivityStagingRepository {
  insertBatch(
    items: RawActivityItem[],
    persistedRaw: PersistedRawActivityItem[],
    productKey: string,
  ): Promise<number>;
}

/** O conjunto completo de repositórios que o Orchestrator recebe. */
export interface IRepositorySet {
  ingestionRun: IIngestionRunRepository;
  rawVenueItem: IRawVenueItemRepository;
  rawActivityItem: IRawActivityItemRepository;
  venueStaging: IVenueStagingRepository;
  activityStaging: IActivityStagingRepository;
}

export interface IVenueReviewRepository {
  list(filter: ReviewFilter): Promise<VenueStagingRow[]>;
  getById(id: string): Promise<VenueStagingRow | null>;
  updateStatus(id: string, ctx: ReviewContext): Promise<void>;
  markPromoted(id: string, reviewedBy: string): Promise<void>;
}

export interface IActivityReviewRepository {
  list(filter: ReviewFilter): Promise<ActivityStagingRow[]>;
  getById(id: string): Promise<ActivityStagingRow | null>;
  updateStatus(id: string, ctx: ReviewContext): Promise<void>;
  markPromoted(id: string, reviewedBy: string): Promise<void>;
}

export interface IIngestionRunReadRepository {
  list(limit?: number): Promise<Array<{
    id: string;
    source_key: string;
    status: string;
    items_collected: number;
    items_errored: number;
    started_at: string;
    finished_at: string | null;
  }>>;
}
