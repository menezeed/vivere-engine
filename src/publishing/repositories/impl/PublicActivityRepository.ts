/**
 * src/publishing/repositories/impl/PublicActivityRepository.ts
 * Escreve em public.activities. Whitelist ADR-0018.
 * NUNCA escreve: category, schedule, price, is_free, is_sponsored,
 *                recurrence_*, interested_count.
 * NOTA: image_url → imagem_url (typo existente — ADR-0015).
 *
 * Level 3, 2026-09-23 — findByEngineId()/findPublicationStateByEngineId()
 * passam a receber EngineActivityId (identidade estável de fonte,
 * source_key+source_item_id via UUIDv5), não mais StagingActivityId. O
 * valor efectivamente gravado em engine_activity_id continua a vir de
 * `activity.stagingId` em insert()/update() — sem mudança aqui, porque
 * ActivityPublisher.adaptToPublishableActivity() já garante que esse campo
 * carrega a identidade estável derivada no momento em que activity chega
 * a este repositório (ver nota nesse método).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublicActivityRepository } from '../interfaces.js';
import type {
  PublishableActivity,
  PublicActivityId,
  StagingActivityId,
  EngineActivityId,
  PublicationRunId,
  PublicActivityPublicationState,
  EngineStatus,
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

  async findByEngineId(engineActivityId: EngineActivityId): Promise<PublicActivityId | null> {
    const { data, error } = await this.db
      .from('activities')
      .select('id')
      .eq('engine_activity_id', engineActivityId)
      .maybeSingle();

    if (error) throw new Error(`PublicActivityRepository.findByEngineId: ${error.message}`);
    return data ? (data.id as PublicActivityId) : null;
  }

  async findPublicationStateByEngineId(engineActivityId: EngineActivityId): Promise<PublicActivityPublicationState | null> {
    const { data, error } = await this.db
      .from('activities')
      .select('id, last_published_at, engine_status')
      .eq('engine_activity_id', engineActivityId)
      .maybeSingle();

    if (error) throw new Error(`PublicActivityRepository.findPublicationStateByEngineId: ${error.message}`);
    if (!data) return null;

    return {
      publicActivityId: data.id as PublicActivityId,
      lastPublishedAt:  new Date(data.last_published_at as string),
      engineStatus:     data.engine_status as EngineStatus,
    };
  }
}
