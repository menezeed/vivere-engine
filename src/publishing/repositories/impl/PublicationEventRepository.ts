/**
 * src/publishing/repositories/impl/PublicationEventRepository.ts
 * Regista eventos de publicação em public.publication_events.
 * Na Fase 8, o NoOpEventEmitter não chama este repositório.
 * Na Fase 9, será chamado pelo EventEmitter concreto.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublicationEventRepository } from '../interfaces.js';
import type { PublicationEvent, PublicationEventId, StagingVenueId } from '../../types/domain.js';

export class PublicationEventRepository implements IPublicationEventRepository {
  constructor(private readonly db: SupabaseClient) {}

  async record(event: PublicationEvent): Promise<PublicationEventId> {
    const { data, error } = await this.db
      .from('publication_events')
      .insert({
        run_id:      event.runId,
        product_key: event.productKey,
        event_type:  event.eventType,
        entity_id:   event.entityId,
        entity_type: event.entityType,
        payload:     event.payload,
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`PublicationEventRepository.record: ${error?.message ?? 'no data'}`);
    return data.id as PublicationEventId;
  }

  async hasVenuePublishedEvent(stagingVenueId: StagingVenueId): Promise<boolean> {
    const { data, error } = await this.db
      .from('publication_events')
      .select('id')
      .eq('event_type', 'VenuePublished')
      .eq('entity_type', 'venue')
      .eq('payload->>engineVenueId', stagingVenueId)
      .limit(1);

    // Falha fechada: o chamador trata o erro como "não inserir".
    if (error) throw new Error(`PublicationEventRepository.hasVenuePublishedEvent: ${error.message}`);
    return (data ?? []).length > 0;
  }
}
