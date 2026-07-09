/**
 * src/publishing/repositories/impl/PublicVenueRepository.ts
 * Escreve em public.venues. Implementa a whitelist ADR-0018.
 * NUNCA escreve: category.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublicVenueRepository } from '../interfaces.js';
import type {
  PublishableVenue,
  PublicVenueId,
  StagingVenueId,
  PublicationRunId,
  PublicVenuePublicationState,
  EngineStatus,
} from '../../types/domain.js';

export class PublicVenueRepository implements IPublicVenueRepository {
  constructor(private readonly db: SupabaseClient) {}

  async insert(venue: PublishableVenue, _runId: PublicationRunId): Promise<PublicVenueId> {
    const { data, error } = await this.db
      .from('venues')
      .insert({
        // Campos do app (whitelist ADR-0018)
        name:             venue.name,
        address:          venue.address,
        lat:              venue.lat,
        lng:              venue.lng,
        phone:            venue.phone,
        website:          venue.website,
        opening_hours:    venue.openingHoursRaw,
        image_url:        venue.imageUrl,
        // Campos da engine
        engine_venue_id:   venue.stagingId,
        source_key:        venue.sourceKey,
        product_key:       venue.productKey,
        engine_status:     'active',
        last_published_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`PublicVenueRepository.insert: ${error?.message ?? 'no data'}`);
    return data.id as PublicVenueId;
  }

  async update(publicVenueId: PublicVenueId, venue: PublishableVenue): Promise<void> {
    const { error } = await this.db
      .from('venues')
      .update({
        name:              venue.name,
        address:           venue.address,
        lat:               venue.lat,
        lng:               venue.lng,
        phone:             venue.phone,
        website:           venue.website,
        opening_hours:     venue.openingHoursRaw,
        image_url:         venue.imageUrl,
        last_published_at: new Date().toISOString(),
        // category, etc. NUNCA aqui (ADR-0018)
      })
      .eq('id', publicVenueId);

    if (error) throw new Error(`PublicVenueRepository.update: ${error.message}`);
  }

  async archive(publicVenueId: PublicVenueId): Promise<void> {
    const { error } = await this.db
      .from('venues')
      .update({ engine_status: 'archived', last_published_at: new Date().toISOString() })
      .eq('id', publicVenueId);

    if (error) throw new Error(`PublicVenueRepository.archive: ${error.message}`);
  }

  async linkToStaging(stagingVenueId: StagingVenueId, publicVenueId: PublicVenueId): Promise<void> {
    const { error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .update({ promoted_venue_id: publicVenueId })
      .eq('id', stagingVenueId);

    if (error) throw new Error(`PublicVenueRepository.linkToStaging: ${error.message}`);
  }

  async findByEngineId(stagingVenueId: StagingVenueId): Promise<PublicVenueId | null> {
    const { data, error } = await this.db
      .from('venues')
      .select('id')
      .eq('engine_venue_id', stagingVenueId)
      .maybeSingle();

    if (error) throw new Error(`PublicVenueRepository.findByEngineId: ${error.message}`);
    return data ? (data.id as PublicVenueId) : null;
  }

  async findPublicationStateByEngineId(engineVenueId: StagingVenueId): Promise<PublicVenuePublicationState | null> {
    const { data, error } = await this.db
      .from('venues')
      .select('id, last_published_at, engine_status')
      .eq('engine_venue_id', engineVenueId)
      .maybeSingle();

    if (error) throw new Error(`PublicVenueRepository.findPublicationStateByEngineId: ${error.message}`);
    if (!data) return null;

    return {
      publicVenueId:   data.id as PublicVenueId,
      lastPublishedAt: new Date(data.last_published_at as string),
      engineStatus:    data.engine_status as EngineStatus,
    };
  }
}
