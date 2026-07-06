/**
 * entity-resolution/repositories/impl/VenueResolutionDecisionRepository.ts
 *
 * Implementação concreta de IVenueResolutionDecisionRepository para Supabase.
 *
 * Responsabilidade: persistência de decisões humanas de resolução.
 * Zero lógica de matching, scoring ou algoritmo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IVenueResolutionDecisionRepository } from '../interfaces.js';
import type {
  ActivityStagingId,
  CandidateId,
  DecisionId,
  DecisionAction,
  ResolutionDecision,
} from '../../types/domain.js';
import { RepositoryError } from '../../errors/index.js';

const TABLE  = 'venue_resolution_decisions';
const SCHEMA = 'staging';

export class VenueResolutionDecisionRepository implements IVenueResolutionDecisionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async record(
    productKey:              string,
    activityId:              ActivityStagingId,
    action:                  DecisionAction,
    acceptedCandidateId:     CandidateId | null,
    userId:                  string,
    notes:                   string | null,
    overrodeHighConfidence:  boolean,
  ): Promise<DecisionId> {
    const { data, error } = await this.db
      .schema(SCHEMA)
      .from(TABLE)
      .insert({
        product_key:              productKey,
        activity_staging_id:      activityId,
        action,
        accepted_candidate_id:    acceptedCandidateId,
        user_id:                  userId,
        notes,
        overrode_high_confidence: overrodeHighConfidence,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new RepositoryError('insert', TABLE, error?.message ?? 'no data returned');
    }

    return data.id as DecisionId;
  }

  async findLatest(activityId: ActivityStagingId): Promise<ResolutionDecision | null> {
    const { data, error } = await this.db
      .schema(SCHEMA)
      .from(TABLE)
      .select('id, product_key, activity_staging_id, action, accepted_candidate_id, user_id, reviewed_at, notes, overrode_high_confidence')
      .eq('activity_staging_id', activityId)
      .order('reviewed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('select(findLatest)', TABLE, error.message);
    }
    if (!data) return null;

    return {
      id:                     data.id as DecisionId,
      productKey:             data.product_key as string,
      activityId:             data.activity_staging_id as ActivityStagingId,
      action:                 data.action as DecisionAction,
      acceptedCandidateId:    data.accepted_candidate_id as CandidateId | null,
      userId:                 data.user_id as string,
      reviewedAt:             new Date(data.reviewed_at as string),
      notes:                  data.notes as string | null,
      overrodeHighConfidence: data.overrode_high_confidence as boolean,
    };
  }

  async findPendingReview(
    productKey: string,
    limit = 50,
  ): Promise<ReadonlyArray<ActivityStagingId>> {
    // Actividades com candidatos gerados mas sem decisão ainda
    // Query: candidates WHERE product_key=? AND decision_outcome IS NULL
    //        GROUP BY activity_staging_id
    //        MINUS activities com decision existente
    const { data, error } = await this.db
      .schema(SCHEMA)
      .from('venue_resolution_candidates')
      .select('activity_staging_id')
      .eq('product_key', productKey)
      .is('decision_outcome', null)
      .limit(limit);

    if (error) {
      throw new RepositoryError('select(findPendingReview)', 'venue_resolution_candidates', error.message);
    }

    // Deduplica — uma actividade pode ter múltiplos candidatos pendentes
    const seen = new Set<string>();
    const result: ActivityStagingId[] = [];
    for (const row of data ?? []) {
      const id = row.activity_staging_id as string;
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id as ActivityStagingId);
      }
    }

    return result;
  }
}
