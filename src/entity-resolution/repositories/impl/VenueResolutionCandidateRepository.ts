/**
 * entity-resolution/repositories/impl/VenueResolutionCandidateRepository.ts
 * Responsabilidade: persistência de candidatos e outcomes. Zero lógica de matching.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IVenueResolutionCandidateRepository } from '../interfaces.js';
import type {
  ResolutionRunId, ActivityStagingId, VenueStagingId,
  CandidateId, DecisionId, RankedCandidate, CandidateScore,
} from '../../types/domain.js';
import { RepositoryError } from '../../errors/index.js';

const TABLE       = 'venue_resolution_candidates';
const VENUE_TABLE = 'venues_staging';
const SCHEMA      = 'staging';

// Valores válidos para o CHECK constraint de primary_match_method na migration 0009
const VALID_METHODS = new Set(['exact', 'contains', 'token_overlap', 'trigram', 'geo', 'address', 'hybrid']);

/**
 * Mapeia os scores para um valor válido do CHECK constraint.
 * Matchers internos (haversine, no_text, no_match, error, fixed) são normalizados.
 */
function toPrimaryMethod(score: CandidateScore): string | null {
  // Prioridade: subMethod válido do name, depois geo, depois address, depois hybrid
  if (score.nameScore?.subMethod && VALID_METHODS.has(score.nameScore.subMethod)) return score.nameScore.subMethod;
  if (score.geoScore !== null) return 'geo';
  if (score.addressScore?.subMethod && VALID_METHODS.has(score.addressScore.subMethod)) return score.addressScore.subMethod;
  if (score.addressScore !== null) return 'address';
  if (score.nameScore !== null) return 'hybrid';
  return null; // nenhum score → null (não viola constraint)
}

/** Auto-classification válida para o CHECK constraint da migration 0009. */
const VALID_CLASSIFICATIONS = new Set(['matched', 'ambiguous', 'unresolved', 'proposed_new']);

function toValidClassification(value: string): string {
  return VALID_CLASSIFICATIONS.has(value) ? value : 'unresolved';
}

export class VenueResolutionCandidateRepository implements IVenueResolutionCandidateRepository {
  constructor(private readonly db: SupabaseClient) {}

  async insertCandidates(
    runId: ResolutionRunId, activityId: ActivityStagingId,
    productKey: string, candidates: readonly RankedCandidate[],
  ): Promise<CandidateId[]> {
    if (candidates.length === 0) return [];

    const rows = candidates.map(rc => {
      const method = toPrimaryMethod(rc.score);
      // Debug temporário — remover após diagnóstico
      if (method && !VALID_METHODS.has(method)) {
        console.error('primary_match_method inválido:', method, 'score:', JSON.stringify({
          nameScoreSubMethod: rc.score.nameScore?.subMethod,
          geoScore: rc.score.geoScore?.value,
          addressScoreSubMethod: rc.score.addressScore?.subMethod,
        }));
      }
      return {
      run_id:               runId,
      product_key:          productKey,
      activity_staging_id:  activityId,
      candidate_venue_id:   rc.candidate.id,
      score:                rc.score.finalScore,
      name_score:           rc.score.nameScore?.value    ?? null,
      geo_score:            rc.score.geoScore?.value     ?? null,
      address_score:        rc.score.addressScore?.value ?? null,
      primary_match_method: method,
      auto_classification:  toValidClassification(rc.autoClassification),
      match_detail: {
        rank:          rc.rank,
        hybridScore:   rc.score.hybridScore,
        boostApplied:  rc.score.boostApplied,
        nameDetail:    rc.score.nameScore?.detail    ?? null,
        geoDetail:     rc.score.geoScore?.detail     ?? null,
        addressDetail: rc.score.addressScore?.detail ?? null,
      },
    };});

    const { data, error } = await this.db.schema(SCHEMA).from(TABLE).insert(rows).select('id');
    if (error || !data) throw new RepositoryError('insert', TABLE, error?.message ?? 'no data returned');
    return data.map(r => r.id as CandidateId);
  }

  async findByActivity(activityId: ActivityStagingId): Promise<ReadonlyArray<{
    id: CandidateId; candidateVenueId: VenueStagingId;
    score: number; nameScore: number | null; geoScore: number | null;
    addressScore: number | null; autoClassification: string; decisionOutcome: string | null;
  }>> {
    const { data, error } = await this.db.schema(SCHEMA).from(TABLE)
      .select('id, candidate_venue_id, score, name_score, geo_score, address_score, auto_classification, decision_outcome')
      .eq('activity_staging_id', activityId).order('score', { ascending: false });

    if (error) throw new RepositoryError('select(findByActivity)', TABLE, error.message);
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

  async setOutcome(candidateId: CandidateId, outcome: 'accepted' | 'rejected' | 'skipped', decisionId: DecisionId): Promise<void> {
    const { error } = await this.db.schema(SCHEMA).from(TABLE)
      .update({ decision_outcome: outcome, decision_id: decisionId }).eq('id', candidateId);
    if (error) throw new RepositoryError('update(setOutcome)', TABLE, error.message);
  }

  async deleteByActivity(activityId: ActivityStagingId): Promise<number> {
    const { data, error } = await this.db.schema(SCHEMA).from(TABLE)
      .delete().eq('activity_staging_id', activityId).is('decision_outcome', null).select('id');
    if (error) throw new RepositoryError('delete(deleteByActivity)', TABLE, error.message);
    return (data ?? []).length;
  }

  async findEligibleVenues(
    productKey: string, allowedStatuses: readonly ('approved' | 'promoted')[],
  ): Promise<ReadonlyArray<{
    id: VenueStagingId; name: string; address: string | null; city: string | null;
    lat: number | null; lng: number | null; google_types: string[];
    source_category_hint: string | null; proposal_status: 'approved' | 'promoted';
  }>> {
    const { data, error } = await this.db.schema(SCHEMA).from(VENUE_TABLE).select(`
      id, name, city, proposal_status,
      raw_venue_items!inner (address, lat, lng, google_types, source_category_hint)
    `).eq('product_key', productKey).in('proposal_status', allowedStatuses as string[]);

    if (error) throw new RepositoryError('select(findEligibleVenues)', VENUE_TABLE, error.message);
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
