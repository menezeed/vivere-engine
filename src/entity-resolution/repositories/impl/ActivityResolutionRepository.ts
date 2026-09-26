/**
 * entity-resolution/repositories/impl/ActivityResolutionRepository.ts
 *
 * Acesso mínimo a activities_staging para o Entity Resolution Engine.
 * Constrói VenueMention a partir das 3 colunas separadas em raw_activity_items:
 *   venue_mention_raw_text, venue_mention_raw_address_text, venue_mention_confidence_hint
 *
 * Level 2, 2026-09-26 — source_key acrescentado ao SELECT/tipo, dentro
 * do JOIN com raw_activity_items já existente (nenhum JOIN novo).
 * Necessário para o EntityResolutionEngine resolver o contexto
 * territorial confiável da fonte (ver
 * ISourceTerritorialContextProvider).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActivityStagingId, AutoClassification, VenueStagingId } from '../../types/domain.js';
import type { VenueMention } from '../../../types/RawActivityItem.js';
import { RepositoryError } from '../../errors/index.js';

export interface ActivityForResolution {
  id:                      ActivityStagingId;
  product_key:             string;
  venue_resolution_status: string;
  venue_mention:           VenueMention | null;
  /**
   * Level 2, 2026-09-26 — raw_activity_items.source_key, ex:
   * 'prefeitura_cabo_frio'. Opcional para preservar compatibilidade
   * com testes existentes que constroem ActivityForResolution sem
   * este campo — ausente é tratado como '' (mesmo fallback que
   * mapRow() já aplica quando o JOIN não devolve source_key).
   */
  source_key?:             string;
}

// SELECT mínimo — apenas campos necessários para o motor ER
const SELECT = `
  id, product_key, venue_resolution_status,
  raw_activity_items!inner (
    source_key,
    venue_mention_raw_text,
    venue_mention_raw_address_text,
    venue_mention_confidence_hint
  )
`;

function buildMention(raw: Record<string, unknown>): VenueMention | null {
  const text = raw['venue_mention_raw_text'] as string | null;
  if (!text) return null;
  return {
    raw_text:         text,
    raw_address_text: (raw['venue_mention_raw_address_text'] as string | null) ?? null,
    confidence_hint:  (raw['venue_mention_confidence_hint'] as VenueMention['confidence_hint']) ?? 'explicit_name',
  };
}

function mapRow(row: Record<string, unknown>): ActivityForResolution {
  const raw = row['raw_activity_items'] as Record<string, unknown>;
  return {
    id:                      row['id'] as ActivityStagingId,
    product_key:             row['product_key'] as string,
    venue_resolution_status: row['venue_resolution_status'] as string,
    venue_mention:           buildMention(raw ?? {}),
    source_key:              (raw?.['source_key'] as string | null) ?? '',
  };
}

export class ActivityResolutionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findUnresolved(productKey: string): Promise<ActivityForResolution[]> {
    const { data, error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .in('venue_resolution_status', ['unresolved', 'ambiguous']);

    if (error) throw new RepositoryError('findUnresolved', 'activities_staging', error.message);
    return (data ?? []).map(r => mapRow(r as Record<string, unknown>));
  }

  async findById(activityId: ActivityStagingId): Promise<ActivityForResolution | null> {
    const { data, error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select(SELECT)
      .eq('id', activityId)
      .maybeSingle();

    if (error) throw new RepositoryError('findById', 'activities_staging', error.message);
    if (!data) return null;
    return mapRow(data as Record<string, unknown>);
  }

  async updateResolutionStatus(
    activityId:      ActivityStagingId,
    classification:  AutoClassification,
    resolvedVenueId: VenueStagingId | null,
    confidenceScore: number | null,
  ): Promise<void> {
    const { error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .update({
        venue_resolution_status:   classification,
        resolved_venue_staging_id: resolvedVenueId,
        resolution_confidence:     confidenceScore,
      })
      .eq('id', activityId);

    if (error) throw new RepositoryError('updateResolutionStatus', 'activities_staging', error.message);
  }
}
