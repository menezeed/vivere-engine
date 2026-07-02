import type { SupabaseClient } from '@supabase/supabase-js';
import type { PersistedRawActivityItem } from '../types/persistenceTypes';
import type { RawActivityItem } from '../../types/RawActivityItem';
import { logger } from '../../lib/logger';

/**
 * Persiste atividades em staging.activities_staging (Camada B).
 *
 * venue_resolution_status nasce sempre como 'unresolved' — nunca é
 * decidido aqui. Entity Resolution (estágio futuro do pipeline) é
 * responsável por atualizar esse campo. Persistência e resolução são
 * responsabilidades separadas por design.
 *
 * Idempotência: ON CONFLICT(raw_activity_item_id) DO NOTHING — requer
 * a constraint UNIQUE(raw_activity_item_id) adicionada pela migration 0003.
 */
export class ActivityStagingRepository {
  private static readonly BATCH_SIZE = 50;

  constructor(private readonly db: SupabaseClient) {}

  async insertBatch(
    items: RawActivityItem[],
    persistedRaw: PersistedRawActivityItem[],
    productKey: string,
  ): Promise<number> {
    if (items.length === 0) return 0;

    // Mapa source_item_id → raw_activity_item_id para FK
    const rawIdBySourceItemId = new Map(
      persistedRaw.map((p) => [p.source_item_id, p.id]),
    );

    let totalInserted = 0;

    for (let i = 0; i < items.length; i += ActivityStagingRepository.BATCH_SIZE) {
      const batch = items.slice(i, i + ActivityStagingRepository.BATCH_SIZE);

      const rows = batch
        .map((item) => {
          const rawId = rawIdBySourceItemId.get(item.source_item_id);
          if (!rawId) {
            logger.warn(
              { source_item_id: item.source_item_id },
              'raw_activity_item_id não encontrado — item não será adicionado a activities_staging',
            );
            return null;
          }

          return {
            raw_activity_item_id:   rawId,
            product_key:            productKey,
            venue_resolution_status: 'unresolved',   // Entity Resolution decide depois
            proposal_status:        'pending_review', // Human Review decide depois
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length === 0) continue;

      const { data, error } = await this.db
        .schema('staging')
        .from('activities_staging')
        .upsert(rows, {
          onConflict: 'raw_activity_item_id',
          ignoreDuplicates: true,
        })
        .select('id');

      if (error) {
        logger.error({ productKey, batchIndex: i, error: error.message }, 'erro ao inserir activities_staging');
        throw new Error(`ActivityStagingRepository.insertBatch: ${error.message}`);
      }

      totalInserted += (data ?? []).length;
    }

    logger.info(
      { productKey, attempted: items.length, inserted: totalInserted },
      'activities_staging inseridos',
    );

    return totalInserted;
  }
}
