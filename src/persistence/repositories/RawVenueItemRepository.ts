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
    google_types:           item.google_types,
    google_business_status: item.google_business_status,
    raw_payload:            item.raw_payload,
  };
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
}
