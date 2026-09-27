import type { SupabaseClient } from '@supabase/supabase-js';
import type { PersistedRawActivityItem } from '../types/persistenceTypes';
import type { RecurrenceDetectedItem } from '../../pipeline/stages/02-recurrence-detection';
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
 *
 * Activity 8/26, 2026-09-26 — Recurrence Detection. Assinatura mudou
 * de RawActivityItem[] para RecurrenceDetectedItem[] (mesmo padrão já
 * usado por VenueStagingRepository.insertBatch() com FilteredVenueItem[])
 * — cada item chega já emparelhado com o resultado do estágio
 * 02-recurrence-detection (pipeline/stages), corrido em memória antes
 * da persistência raw. recurrence_type/recurrence_days/recurrence_time
 * (migration 0018) são escritos aqui tal como o estágio os produziu —
 * NULL quando nenhuma recorrência foi detectada, nunca 'none' literal
 * (a normalização para 'none' pertence à Activity 9, Publishing).
 */
export class ActivityStagingRepository {
  private static readonly BATCH_SIZE = 50;

  constructor(private readonly db: SupabaseClient) {}

  async insertBatch(
    items: RecurrenceDetectedItem[],
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
        .map(({ item, recurrence }) => {
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
            recurrence_type:        recurrence.recurrence_type,
            recurrence_days:        recurrence.recurrence_days,
            recurrence_time:        recurrence.recurrence_time,
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
