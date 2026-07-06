/**
 * entity-resolution/repositories/impl/VenueResolutionCandidateRepository.ts
 *
 * Implementação concreta de IVenueResolutionCandidateRepository para Supabase.
 *
 * Responsabilidade: persistência de candidatos e outcomes de decisão.
 * Zero lógica de matching, scoring ou algoritmo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IVenueResolutionCandidateRepository } from '../interfaces.js';
import type {
  ResolutionRunId,
  ActivityStagingId,
  VenueStagingId,
  CandidateId,
  DecisionId,
  RankedCandidate,
} from '../../types/domain.js';
import { RepositoryError } from '../../errors/index.js';

const TABLE         = 'venue_resolution_candidates';
const VENUE_TABLE   = 'venues_staging';
const SCHEMA        = 'staging';

export class VenueResolutionCandidateRepository implements IVenueResolutionCandidateRepository {
  constructor(private readonly db: SupabaseClient) {}

  async insertCandidates(
    runId:      ResolutionRunId,
    activityId: ActivityStagingId,
    productKey: string,
    candidates: readonly RankedCandidate[],
  ): Promise<CandidateId[]> {
    if (candidates.length === 0) return [];

    const rows = candidates.map(rc => ({
      run_id:               runId,
      product_key:          productKey,
      activity_staging_id:  activityId,
      candidate_venue_id:   rc.candidate.id,
      score:                rc.score.finalScore,
      name_score:           rc.score.nameScore?.value ?? null,
      geo_score:            rc.score.geoScore?.value  ?? null,
      address_score:        rc.score.addressScore?.value ?? null,
      // primary_match_method usa subMethod (ex: 'exact','contains','trigram') quando disponível.
      // Para geo e address o method já é o valor correcto para o CHECK constraint.
      primary_match_method: rc.score.nameScore?.subMethod
        ?? rc.score.geoScore?.method
        ?? rc.score.addressScore?.subMethod
        ?? rc.score.addressScore?.method
        ?? null,
      auto_classification:  rc.autoClassification,
      match_detail: {
        rank:         rc.rank,
        hybridScore:  rc.score.hybridScore,
        boostApplied: rc.score.boostApplied,
        nameDetail:   rc.score.nameScore?.detail   ?? null,
        geoDetail:    rc.score.geoScore?.detail    ?? null,
        addressDetail: rc.score.addressScore?.detail ?? null,
      },
    }));

    const { data, error } = await this.db
      .schema(SCHEMA)
      .from(TABLE)
      .insert(rows)
      .select('id');

    if (error || !data) {
      throw new RepositoryError('insert', TABLE, error?.message ?? 'no data returned');
    }

    return data.map(r => r.id as CandidateId);
  }

  async findByActivity(activityId: ActivityStagingId): Promise<ReadonlyArray<{
    id:                 CandidateId;
    candidateVenueId:   VenueStagingId;
    score:              number;
    nameScore:          number | null;
    geoScore:           number | null;
    addressScore:       number | null;
    autoClassification: string;
    decisionOutcome:    string | null;
  }>> {
    const { data, error } = await this.db
      .schema(SCHEMA)
      .from(TABLE)
      .select('id, candidate_venue_id, score, name_score, geo_score, address_score, auto_classification, decision_outcome')
      .eq('activity_staging_id', activityId)
      .order('score', { ascending: false });

    if (error) {
      throw new RepositoryError('select(findByActivity)', TABLE, error.message);
    }

    return (data ?? []).map(r => ({
      id:                 r.id as CandidateId,
      candidateVenueId:   r.candidate_venue_id as VenueStagingId,
      score:              r.score as number,
      nameScore:          r.name_score as number | null,
      geoScore:           r.geo_score  as number | null,
      addressScore:       r.address_score as number | null,
      autoClassification: r.auto_classification as string,
      decisionOutcome:    r.decision_outcome as string | null,
    }));
  }

  async setOutcome(
    candidateId: CandidateId,
    outcome:     'accepted' | 'rejected' | 'skipped',
    decisionId:  DecisionId,
  ): Promise<void> {
    const { error } = await this.db
      .schema(SCHEMA)
      .from(TABLE)
      .update({
        decision_outcome: outcome,
        decision_id:      decisionId,
      })
      .eq('id', candidateId);

    if (error) {
      throw new RepositoryError('update(setOutcome)', TABLE, error.message);
    }
  }

  async deleteByActivity(activityId: ActivityStagingId): Promise<number> {
    // Apenas apaga candidatos SEM decisão humana (ADR-0013)
    const { data, error } = await this.db
      .schema(SCHEMA)
      .from(TABLE)
      .delete()
      .eq('activity_staging_id', activityId)
      .is('decision_outcome', null)
      .select('id');

    if (error) {
      throw new RepositoryError('delete(deleteByActivity)', TABLE, error.message);
    }

    return (data ?? []).length;
  }

  async findEligibleVenues(
    productKey:      string,
    allowedStatuses: readonly ('approved' | 'promoted')[],
  ): Promise<ReadonlyArray<{
    id:                   VenueStagingId;
    name:                 string;
    address:              string | null;
    city:                 string | null;
    lat:                  number | null;
    lng:                  number | null;
    google_types:         string[];
    source_category_hint: string | null;
    proposal_status:      'approved' | 'promoted';
  }>> {
    // venues_staging só tem: id, product_key, proposal_status, city, name
    // Os campos de detalhe (address, lat, lng, etc.) estão em raw_venue_items
    // JOIN via raw_venue_item_id para obter todos os campos necessários ao matching
    const { data, error } = await this.db
      .schema(SCHEMA)
      .from(VENUE_TABLE)
      .select(`
        id,
        name,
        city,
        proposal_status,
        raw_venue_items!inner (
          address, lat, lng, google_types, source_category_hint
        )
      `)
      .eq('product_key', productKey)
      .in('proposal_status', allowedStatuses as string[]);

    if (error) {
      throw new RepositoryError('select(findEligibleVenues)', VENUE_TABLE, error.message);
    }

    return (data ?? []).map(r => {
      const raw = (r as Record<string, unknown>)['raw_venue_items'] as Record<string, unknown>;
      return {
        id:                   r.id as VenueStagingId,
        name:                 (r.name ?? '') as string,
        address:              (raw?.['address'] ?? null) as string | null,
        city:                 r.city as string | null,
        lat:                  (raw?.['lat'] ?? null) as number | null,
        lng:                  (raw?.['lng'] ?? null) as number | null,
        google_types:         ((raw?.['google_types']) ?? []) as string[],
        source_category_hint: (raw?.['source_category_hint'] ?? null) as string | null,
        proposal_status:      r.proposal_status as 'approved' | 'promoted',
      };
    });
  }
}
