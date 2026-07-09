/**
 * src/publishing/repositories/impl/PublicActivityRepository.ts
 * Escreve em public.activities. Whitelist ADR-0018.
 * NUNCA escreve: category, schedule, price, is_free, is_sponsored,
 *                recurrence_*, interested_count.
 * NOTA: image_url → imagem_url (typo existente — ADR-0015).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublicActivityRepository } from '../interfaces.js';
import type {
  PublishableActivity,
  PublicActivityId,
  StagingActivityId,
  PublicationRunId,
} from '../../types/domain.js';

export class PublicActivityRepository implements IPublicActivityRepository {
  constructor(private readonly db: SupabaseClient) {}

  async insert(activity: PublishableActivity, _runId: PublicationRunId): Promise<PublicActivityId> {
    const { data, error } = await this.db
      .from('activities')
      .insert({
        // Campos do app (whitelist ADR-0018)
        title:             activity.title,
        description:       activity.description,
        start_date:        activity.startDate?.toISOString() ?? null,
        end_date:          activity.endDate?.toISOString()   ?? null,
        imagem_url:        activity.imageUrl,     // typo intencional (ADR-0015)
        url:               activity.sourceUrl,
        phone:             activity.phone,
        venue_id:          activity.resolvedPublicVenueId ?? null,
        // Campos da engine
        engine_activity_id: activity.stagingId,
        source_key:         activity.sourceKey,
        product_key:        activity.productKey,
        engine_status:      'active',
        last_published_at:  new Date().toISOString(),
        // category, schedule, price, is_free, is_sponsored,
        // recurrence_*, interested_count → NUNCA aqui (ADR-0018)
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`PublicActivityRepository.insert: ${error?.message ?? 'no data'}`);
    return data.id as PublicActivityId;
  }

  async update(publicActivityId: PublicActivityId, activity: PublishableActivity): Promise<void> {
    const { error } = await this.db
      .from('activities')
      .update({
        title:             activity.title,
        description:       activity.description,
        start_date:        activity.startDate?.toISOString() ?? null,
        end_date:          activity.endDate?.toISOString()   ?? null,
        imagem_url:        activity.imageUrl,
        url:               activity.sourceUrl,
        phone:             activity.phone,
        venue_id:          activity.resolvedPublicVenueId ?? null,
        last_published_at: new Date().toISOString(),
      })
      .eq('id', publicActivityId);

    if (error) throw new Error(`PublicActivityRepository.update: ${error.message}`);
  }

  async archive(publicActivityId: PublicActivityId): Promise<void> {
    const { error } = await this.db
      .from('activities')
      .update({ engine_status: 'archived', last_published_at: new Date().toISOString() })
      .eq('id', publicActivityId);

    if (error) throw new Error(`PublicActivityRepository.archive: ${error.message}`);
  }

  async linkToStaging(stagingActivityId: StagingActivityId, publicActivityId: PublicActivityId): Promise<void> {
    const { error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .update({ promoted_activity_id: publicActivityId })
      .eq('id', stagingActivityId);

    if (error) throw new Error(`PublicActivityRepository.linkToStaging: ${error.message}`);
  }

  async findByEngineId(stagingActivityId: StagingActivityId): Promise<PublicActivityId | null> {
    const { data, error } = await this.db
      .from('activities')
      .select('id')
      .eq('engine_activity_id', stagingActivityId)
      .maybeSingle();

    if (error) throw new Error(`PublicActivityRepository.findByEngineId: ${error.message}`);
    return data ? (data.id as PublicActivityId) : null;
  }
}
