/**
 * src/publishing/repositories/impl/PublishableActivityRepository.ts
 * Lê activities com decisão humana prontas para publicar. Zero escrita.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublishableActivityRepository } from '../interfaces.js';
import type {
  PublishableActivity,
  StagingActivityId,
  PublicVenueId,
  PublicActivityId,
} from '../../types/domain.js';

const SELECT = `
  id, product_key, promoted_activity_id, resolved_venue_staging_id, updated_at,
  raw_activity_items!inner (
    source_key,
    title, body_text, event_date, image_url, source_url, phone
  )
`;

function mapRow(
  row:      Record<string, unknown>,
  venueMap: Map<string, string>,
): PublishableActivity {
  const raw = row['raw_activity_items'] as Record<string, unknown>;
  const stagingVenueId = row['resolved_venue_staging_id'] as string | null;

  return {
    stagingId:             row['id'] as StagingActivityId,
    productKey:            row['product_key'] as string,
    sourceKey:             (raw['source_key'] as string | null) ?? 'prefeitura_cabo_frio',
    title:                 (raw['title'] as string | null) ?? '',
    description:           (raw['body_text'] as string | null) ?? null,
    startDate:             raw['event_date'] ? new Date(raw['event_date'] as string) : null,
    endDate:               null,
    imageUrl:              (raw['image_url'] as string | null) ?? null,
    sourceUrl:             (raw['source_url'] as string | null) ?? null,
    phone:                 (raw['phone'] as string | null) ?? null,
    resolvedPublicVenueId: stagingVenueId
      ? (venueMap.get(stagingVenueId) ?? null) as PublicVenueId | null
      : null,
    promotedActivityId:    (row['promoted_activity_id'] as string | null) as PublicActivityId | null,
    stagingUpdatedAt:      new Date(row['updated_at'] as string ?? Date.now()),
  };
}

export class PublishableActivityRepository implements IPublishableActivityRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findUnpublished(productKey: string): Promise<readonly PublishableActivity[]> {
    const { data, error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .in('venue_resolution_status', ['matched', 'proposed_new'])
      .is('promoted_activity_id', null);

    if (error) throw new Error(`PublishableActivityRepository.findUnpublished: ${error.message}`);
    return this.enrichWithPublicVenueIds((data ?? []) as Record<string, unknown>[]);
  }

  async findDirty(productKey: string): Promise<readonly PublishableActivity[]> {
    const { data, error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .in('venue_resolution_status', ['matched', 'proposed_new'])
      .not('promoted_activity_id', 'is', null);

    if (error) throw new Error(`PublishableActivityRepository.findDirty: ${error.message}`);
    return this.enrichWithPublicVenueIds((data ?? []) as Record<string, unknown>[]);
  }

  /**
   * Resolve staging venue IDs para public venue IDs.
   * Necesssário porque public.activities.venue_id referencia public.venues.id,
   * mas em staging temos apenas o staging venue ID.
   */
  private async enrichWithPublicVenueIds(
    rows: Record<string, unknown>[],
  ): Promise<readonly PublishableActivity[]> {
    // Recolher todos os staging venue IDs únicos
    const stagingVenueIds = [
      ...new Set(
        rows
          .map(r => r['resolved_venue_staging_id'] as string | null)
          .filter((id): id is string => id !== null),
      ),
    ];

    // Buscar os promoted_venue_id correspondentes em venues_staging
    const venueMap = new Map<string, string>();
    if (stagingVenueIds.length > 0) {
      const { data: venues } = await this.db
        .schema('staging')
        .from('venues_staging')
        .select('id, promoted_venue_id')
        .in('id', stagingVenueIds)
        .not('promoted_venue_id', 'is', null);

      for (const v of venues ?? []) {
        if (v.promoted_venue_id) {
          venueMap.set(v.id as string, v.promoted_venue_id as string);
        }
      }
    }

    return rows.map(r => mapRow(r, venueMap));
  }
}
