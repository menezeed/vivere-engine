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
  /**
   * Entradas em errors[] do collector. Nas fontes WordPress de
   * actividades são posts DESCARTADOS (nenhum item gerado: narrativa
   * ambígua, sem programação extraível) — um item gerado sem data NÃO
   * conta aqui (já conta como "sem data" no L4 e leva review_reasons).
   */
  rawItemsErrored: number;
  /**
   * rawItemsErrored agregado pela CLASSE do erro (o prefixo do motivo,
   * ex.: 'narrative_ambiguous'), sem conteúdo dos posts. Só nas
   * ingestões de actividades.
   */
  rawItemsErroredByReason?: Record<string, number>;
  stagedItems: number;
  rejectedItems: number;
  /** ADR-0022 (Regional Geographic Gate) — itens excluídos da onda regional, nunca chegam a venues_staging. 0 quando a fonte não declara regions. */
  geoExcludedItems: number;
}
