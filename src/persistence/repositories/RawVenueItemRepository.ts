import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawVenueItem } from '../../types/RawVenueItem';
import type { PersistedRawVenueItem } from '../types/persistenceTypes';
import { logger } from '../../lib/logger';

/**
 * Mapeia um RawVenueItem TypeScript para uma row de staging.raw_venue_items.
 * Esta função é o único lugar onde os nomes de campo do contrato TypeScript
 * são traduzidos para os nomes de coluna SQL — mantendo essa fronteira explícita.
 */
function toRow(item: RawVenueItem, ingestionRunId: string): Record<string, unknown> {
  return {
    ingestion_run_id:       ingestionRunId,
    source_key:             item.source_key,
    source_item_id:         item.source_item_id,
    collected_at:           item.collected_at,
    name:                   item.name,
    address:                item.address,
    lat:                    item.lat,
    lng:                    item.lng,
    phone:                  item.phone,
    website:                item.website,
    opening_hours_raw:      item.opening_hours_raw,
    image_url:              item.image_url,
    source_category_hint:   item.source_category_hint,
    source_query_text:      item.source_query_text,
    source_query_kind:      item.source_query_kind,
    source_region_label:    item.source_region_label,
    google_types:           item.google_types,
    google_business_status: item.google_business_status,
    raw_payload:            item.raw_payload,
  };
}

/**
 * Mapeamento inverso de toRow() — reconstrói um RawVenueItem a partir
 * de uma row lida de staging.raw_venue_items, junto com o
 * PersistedRawVenueItem (id + source_item_id) que já existe nessa
 * mesma row. Usado só por findByRegionLabel — insertBatch nunca lê,
 * só escreve.
 */
function fromRow(row: Record<string, unknown>): { item: RawVenueItem; persisted: PersistedRawVenueItem } {
  const item: RawVenueItem = {
    source_key:             row.source_key as string,
    source_item_id:         row.source_item_id as string,
    collected_at:           row.collected_at as string,
    name:                   row.name as string,
    address:                row.address as string | null,
    lat:                    row.lat as number,
    lng:                    row.lng as number,
    phone:                  row.phone as string | null,
    website:                row.website as string | null,
    opening_hours_raw:      row.opening_hours_raw as string[] | null,
    image_url:              row.image_url as string | null,
    source_category_hint:   row.source_category_hint as string,
    source_query_text:      row.source_query_text as string,
    source_query_kind:      row.source_query_kind as RawVenueItem['source_query_kind'],
    source_region_label:    (row.source_region_label as string | null) ?? undefined,
    google_types:           row.google_types as string[],
    google_business_status: row.google_business_status as RawVenueItem['google_business_status'],
    raw_payload:            row.raw_payload as Record<string, unknown>,
  };

  const persisted: PersistedRawVenueItem = {
    id: row.id as string,
    source_item_id: row.source_item_id as string,
  };

  return { item, persisted };
}

/**
 * Persiste RawVenueItem na Camada A (staging.raw_venue_items).
 *
 * APPEND-ONLY: nunca usa UPDATE. A idempotência é garantida pela
 * constraint UNIQUE(source_key, source_item_id, ingestion_run_id)
 * via ON CONFLICT DO NOTHING — reexecuções são seguras.
 *
 * Retorna só os itens efetivamente inseridos (conflitos são silenciosos).
 * O chamador usa os ids retornados para FK em venues_staging.
 */
export class RawVenueItemRepository {
  private static readonly BATCH_SIZE = 50;

  constructor(private readonly db: SupabaseClient) {}

  async insertBatch(items: RawVenueItem[], ingestionRunId: string): Promise<PersistedRawVenueItem[]> {
    if (items.length === 0) return [];

    const persisted: PersistedRawVenueItem[] = [];

    // Processa em batches para evitar payloads HTTP excessivos
    for (let i = 0; i < items.length; i += RawVenueItemRepository.BATCH_SIZE) {
      const batch = items.slice(i, i + RawVenueItemRepository.BATCH_SIZE);
      const rows = batch.map((item) => toRow(item, ingestionRunId));

      const { data, error } = await this.db
        .schema('staging')
        .from('raw_venue_items')
        .upsert(rows, {
          onConflict: 'source_key,source_item_id,ingestion_run_id',
          ignoreDuplicates: true,  // ON CONFLICT DO NOTHING
        })
        .select('id, source_item_id');

      if (error) {
        logger.error({ ingestionRunId, batchIndex: i, error: error.message }, 'erro ao inserir raw_venue_items');
        throw new Error(`RawVenueItemRepository.insertBatch: ${error.message}`);
      }

      const batchPersisted = (data ?? []).map((row) => ({
        id: row.id as string,
        source_item_id: row.source_item_id as string,
      }));

      persisted.push(...batchPersisted);
    }

    logger.info(
      { ingestionRunId, attempted: items.length, persisted: persisted.length },
      'raw_venue_items inseridos',
    );

    return persisted;
  }

  /**
   * Lê itens já persistidos na Camada A por source_key + região —
   * NUNCA por product_key, que não existe nesta tabela. Usado pelo
   * reprocessamento (IngestionOrchestrator.reprocessVenuesFromRaw)
   * para reaproveitar dados já coletados e pagos, sem chamar a fonte
   * externa outra vez.
   *
   * Devolve id + item reconstruído na MESMA query — nunca passa por
   * insertBatch, cujo upsert com ignoreDuplicates:true devolveria
   * lista vazia para linhas já existentes (ON CONFLICT DO NOTHING não
   * retorna as linhas em conflito).
   */
  async findByRegionLabel(
    sourceKey: string,
    regionLabel: string,
  ): Promise<{ item: RawVenueItem; persisted: PersistedRawVenueItem }[]> {
    const { data, error } = await this.db
      .schema('staging')
      .from('raw_venue_items')
      .select(
        'id, source_key, source_item_id, collected_at, name, address, lat, lng, phone, website, ' +
          'opening_hours_raw, image_url, source_category_hint, source_query_text, source_query_kind, ' +
          'source_region_label, google_types, google_business_status, raw_payload',
      )
      .eq('source_key', sourceKey)
      .eq('source_region_label', regionLabel);

    if (error) {
      logger.error({ sourceKey, regionLabel, error: error.message }, 'erro ao ler raw_venue_items');
      throw new Error(`RawVenueItemRepository.findByRegionLabel: ${error.message}`);
    }

    const result = (data ?? []).map((row) => fromRow(row as unknown as Record<string, unknown>));

    logger.info(
      { sourceKey, regionLabel, found: result.length },
      'raw_venue_items lidos para reprocessamento',
    );

    return result;
  }
}
