/**
 * Tipos internos da camada de persistência da Vivere Engine.
 * Distintos dos contratos de Collector (RawVenueItem, RawActivityItem)
 * porque representam registros JÁ PERSISTIDOS, com id gerado pelo banco.
 */

/** Um RawVenueItem após INSERT bem-sucedido — tem o uuid gerado pelo banco. */
export interface PersistedRawVenueItem {
  id: string;             // uuid gerado pelo banco (staging.raw_venue_items.id)
  source_item_id: string; // para correlacionar com FilteredVenueItem original
}

/** Um RawActivityItem após INSERT bem-sucedido — tem o uuid gerado pelo banco. */
export interface PersistedRawActivityItem {
  id: string;             // uuid gerado pelo banco (staging.raw_activity_items.id)
  source_item_id: string;
}

/** Sumário retornado pelo IngestionOrchestrator ao final de uma execução. */
export interface IngestionSummary {
  ingestionRunId: string | null; // null em dry-run
  dryRun: boolean;
  rawItemsCollected: number;
  rawItemsPersisted: number;     // pode diferir de collected em caso de conflito de idempotência
  rawItemsErrored: number;
  stagedItems: number;
  rejectedItems: number;
}
