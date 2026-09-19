import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawActivityItem } from '../../types/RawActivityItem';
import type { PersistedRawActivityItem } from '../types/persistenceTypes';
import { logger } from '../../lib/logger';

/**
 * Mapeia RawActivityItem → row SQL.
 *
 * VenueMention é um valor embutido no contrato TypeScript, mas no banco
 * é representado como colunas planas (venue_mention_raw_text, etc.)
 * em vez de JSONB — decisão da migration 0001 para facilitar queries
 * por texto de menção sem precisar de operadores JSONB.
 *
 * occurrences é uma coluna JSONB. O Collector já fornece um array nativo
 * de objetos com date, time, end_date e end_time, portanto o valor é enviado
 * diretamente ao Supabase sem JSON.stringify() manual.
 */
function toRow(item: RawActivityItem, ingestionRunId: string): Record<string, unknown> {
  return {
    ingestion_run_id:               ingestionRunId,
    source_key:                     item.source_key,
    source_item_id:                 item.source_item_id,
    collected_at:                   item.collected_at,
    title:                          item.title,
    description:                    item.description,
    raw_category_text:              item.raw_category_text,
    occurrences:                    item.occurrences,
    recurrence_text_hint:           item.recurrence_text_hint,
    venue_mention_raw_text:         item.venue_mention?.raw_text ?? null,
    venue_mention_raw_address_text: item.venue_mention?.raw_address_text ?? null,
    venue_mention_confidence_hint:  item.venue_mention?.confidence_hint ?? null,
    price_text:                     item.price_text,
    is_free_hint:                   item.is_free_hint,
    image_url:                      item.image_url,
    external_url:                   item.external_url,
    contact_phone:                  item.contact_phone,
    contact_email:                  item.contact_email,
    language:                       item.language,
    raw_payload:                    item.raw_payload,
  };
}

/**
 * Persiste RawActivityItem na Camada A (staging.raw_activity_items).
 * Mesmos princípios de RawVenueItemRepository: append-only, ON CONFLICT
 * DO NOTHING, retorna só os efetivamente inseridos.
 */
export class RawActivityItemRepository {
  private static readonly BATCH_SIZE = 50;

  constructor(private readonly db: SupabaseClient) {}

  async insertBatch(items: RawActivityItem[], ingestionRunId: string): Promise<PersistedRawActivityItem[]> {
    if (items.length === 0) return [];

    const persisted: PersistedRawActivityItem[] = [];

    for (let i = 0; i < items.length; i += RawActivityItemRepository.BATCH_SIZE) {
      const batch = items.slice(i, i + RawActivityItemRepository.BATCH_SIZE);
      const rows = batch.map((item) => toRow(item, ingestionRunId));

      const { data, error } = await this.db
        .schema('staging')
        .from('raw_activity_items')
        .upsert(rows, {
          onConflict: 'source_key,source_item_id,ingestion_run_id',
          ignoreDuplicates: true,
        })
        .select('id, source_item_id');

      if (error) {
        logger.error({ ingestionRunId, batchIndex: i, error: error.message }, 'erro ao inserir raw_activity_items');
        throw new Error(`RawActivityItemRepository.insertBatch: ${error.message}`);
      }

      const batchPersisted = (data ?? []).map((row) => ({
        id: row.id as string,
        source_item_id: row.source_item_id as string,
      }));

      persisted.push(...batchPersisted);
    }

    logger.info(
      { ingestionRunId, attempted: items.length, persisted: persisted.length },
      'raw_activity_items inseridos',
    );

    return persisted;
  }
}
