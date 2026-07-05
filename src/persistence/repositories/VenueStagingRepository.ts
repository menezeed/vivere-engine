import type { SupabaseClient } from '@supabase/supabase-js';
import type { PersistedRawVenueItem } from '../types/persistenceTypes';
import type { FilteredVenueItem } from '../../pipeline/stages/00-filter-venue/index';
import { logger } from '../../lib/logger';

/**
 * Persiste o resultado do Venue Filtering Engine em staging.venues_staging.
 *
 * NUNCA persiste itens com decisão 'rejected' — esses são descartados
 * silenciosamente pelo Orchestrator antes de chegar aqui.
 *
 * A decisão do filtro (accepted, needs_review, <AmbiguityLabel>) é
 * guardada em raw_payload como metadado de auditoria — não como coluna
 * própria, porque a estrutura de proposal_status já cobre o que o
 * Human Review precisa ver.
 *
 * Idempotência: ON CONFLICT(raw_venue_item_id) DO NOTHING — requer
 * a constraint UNIQUE(raw_venue_item_id) adicionada pela migration 0003.
 */
export class VenueStagingRepository {
  private static readonly BATCH_SIZE = 50;

  constructor(private readonly db: SupabaseClient) {}

  async insertBatch(
    filteredItems: FilteredVenueItem<string, string>[],
    persistedRaw: PersistedRawVenueItem[],
    productKey: string,
  ): Promise<number> {
    // Constrói mapa source_item_id → raw_venue_item_id para FK
    const rawIdBySourceItemId = new Map(
      persistedRaw.map((p) => [p.source_item_id, p.id]),
    );

    // Filtra rejected antes de qualquer operação de banco
    const toInsert = filteredItems.filter((f) => f.filter.decision !== 'rejected');

    if (toInsert.length === 0) return 0;

    let totalInserted = 0;

    for (let i = 0; i < toInsert.length; i += VenueStagingRepository.BATCH_SIZE) {
      const batch = toInsert.slice(i, i + VenueStagingRepository.BATCH_SIZE);

      const rows = batch
        .map((f) => {
          const rawId = rawIdBySourceItemId.get(f.item.source_item_id);
          if (!rawId) {
            // Item não foi persistido na Camada A (provavelmente conflito de
            // idempotência em raw_venue_items) — não entra em staging sem FK
            logger.warn(
              { source_item_id: f.item.source_item_id },
              'raw_venue_item_id não encontrado — item não será adicionado a venues_staging',
            );
            return null;
          }

          return {
            raw_venue_item_id: rawId,
            source_key:        f.item.source_key,
            source_item_id:    f.item.source_item_id,
            product_key:       productKey,
            proposal_status:   'pending_review',
            city:              (f.item as import('../../types/RawVenueItem').RawVenueItem).source_region_label ?? null,
            name:              f.item.name ?? null,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length === 0) continue;

      const { data, error } = await this.db
        .schema('staging')
        .from('venues_staging')
        .upsert(rows, {
          onConflict: 'source_key,source_item_id,product_key',
          ignoreDuplicates: true,
        })
        .select('id');

      if (error) {
        logger.error({ productKey, batchIndex: i, error: error.message }, 'erro ao inserir venues_staging');
        throw new Error(`VenueStagingRepository.insertBatch: ${error.message}`);
      }

      totalInserted += (data ?? []).length;
    }

    logger.info(
      { productKey, attempted: toInsert.length, inserted: totalInserted },
      'venues_staging inseridos',
    );

    return totalInserted;
  }
}
