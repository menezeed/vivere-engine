/**
 * src/publishing/repositories/impl/PublishableVenueRepository.ts
 * Lê venues de staging prontos para publicar. Zero escrita.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublishableVenueRepository } from '../interfaces.js';
import type { PublishableVenue, PublicVenueId, StagingVenueId } from '../../types/domain.js';

const SELECT = `
  id, product_key, promoted_venue_id, updated_at,
  raw_venue_items!inner (
    source_key,
    name,
    address, lat, lng, phone, website,
    opening_hours_raw, image_url
  )
`;

function mapRow(row: Record<string, unknown>): PublishableVenue {
  const raw = row['raw_venue_items'] as Record<string, unknown>;
  return {
    stagingId:        row['id'] as StagingVenueId,
    productKey:       row['product_key'] as string,
    sourceKey:        (raw['source_key'] as string | null) ?? 'google_places',
    name:             (raw['name'] as string | null) ?? '',
    address:          (raw['address'] as string | null) ?? null,
    lat:              (raw['lat'] as number | null) ?? null,
    lng:              (raw['lng'] as number | null) ?? null,
    phone:            (raw['phone'] as string | null) ?? null,
    website:          (raw['website'] as string | null) ?? null,
    openingHoursRaw:  (raw['opening_hours_raw'] as string | null) ?? null,
    imageUrl:         (raw['image_url'] as string | null) ?? null,
    promotedVenueId:  (row['promoted_venue_id'] as string | null) as PublicVenueId | null,
    stagingUpdatedAt: new Date(row['updated_at'] as string ?? Date.now()),
  };
}

export class PublishableVenueRepository implements IPublishableVenueRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findUnpublished(productKey: string): Promise<readonly PublishableVenue[]> {
    const { data, error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .eq('proposal_status', 'promoted')
      .is('promoted_venue_id', null);

    if (error) throw new Error(`PublishableVenueRepository.findUnpublished: ${error.message}`);
    return (data ?? []).map(r => mapRow(r as Record<string, unknown>));
  }

  async findDirty(productKey: string): Promise<readonly PublishableVenue[]> {
    // Venues já publicados cujos dados mudaram após a última publicação.
    // O dirty check real compara updated_at vs last_published_at em public.venues —
    // feito em memória no VenuePublisher após join com public.venues via promoted_venue_id.
    // Aqui retornamos todos os venues promoted com promoted_venue_id preenchido.
    const { data, error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .eq('proposal_status', 'promoted')
      .not('promoted_venue_id', 'is', null);

    if (error) throw new Error(`PublishableVenueRepository.findDirty: ${error.message}`);
    return (data ?? []).map(r => mapRow(r as Record<string, unknown>));
  }

  async findToArchive(productKey: string): Promise<readonly PublishableVenue[]> {
    // Venues que já foram publicados mas foram rejeitados depois.
    const { data, error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .eq('proposal_status', 'rejected')
      .not('promoted_venue_id', 'is', null);

    if (error) throw new Error(`PublishableVenueRepository.findToArchive: ${error.message}`);
    return (data ?? []).map(r => mapRow(r as Record<string, unknown>));
  }
}
