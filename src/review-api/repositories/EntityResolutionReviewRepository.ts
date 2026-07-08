/**
 * src/review-api/repositories/EntityResolutionReviewRepository.ts
 *
 * Repositório de leitura e escrita para a Review API de Entity Resolution.
 * Mesmo padrão de VenueReviewRepository — apenas persistência, sem regras de negócio.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildListResponse } from '../types/listTypes.js';
import type { ListResponse } from '../types/listTypes.js';

// ── Tipos de output ───────────────────────────────────────────────────────────

export interface ERQueueItem {
  activityId:             string;
  productKey:             string;
  title:                  string | null;
  venueMentionText:       string | null;
  venueMentionHint:       string | null;
  venueResolutionStatus:  string;
  resolutionConfidence:   number | null;
  topCandidateName:       string | null;
  candidateCount:         number;
  createdAt:              string;
}

export interface ERCandidate {
  id:                   string;
  candidateVenueId:     string;
  venueName:            string;
  venueCity:            string | null;
  venueLat:             number | null;
  venueLng:             number | null;
  score:                number;
  nameScore:            number | null;
  geoScore:             number | null;
  addressScore:         number | null;
  autoClassification:   string;
  decisionOutcome:      string | null;
  matchDetail:          Record<string, unknown> | null;
  rank:                 number | null;
}

export interface ERStats {
  total:        number;
  matched:      number;
  ambiguous:    number;
  unresolved:   number;
  proposed_new: number;
  no_mention:   number;
  decided:      number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export interface ERQueueQuery {
  product_key: string;
  status?:     string;
  page?:       number;
  pageSize?:   number;
}

// ── Repository ────────────────────────────────────────────────────────────────

export class EntityResolutionReviewRepository {
  constructor(private readonly db: SupabaseClient) {}

  // ── Fila de revisão ────────────────────────────────────────────────────────

  async listQueue(query: ERQueueQuery): Promise<ListResponse<ERQueueItem>> {
    const page     = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const offset   = (page - 1) * pageSize;

    let q = this.db
      .schema('staging')
      .from('activities_staging')
      .select(`
        id, product_key, venue_resolution_status, resolution_confidence,
        resolved_venue_staging_id,
        raw_activity_items!inner (
          title,
          venue_mention_raw_text,
          venue_mention_confidence_hint
        )
      `, { count: 'exact' })
      .eq('product_key', query.product_key)
      .order('resolution_confidence', { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);

    // Filtrar por status se especificado
    if (query.status && query.status !== 'all') {
      q = q.eq('venue_resolution_status', query.status);
    }

    const { data, error, count } = await q;
    if (error) throw new Error(`listQueue: ${error.message}`);

    const items: ERQueueItem[] = await Promise.all((data ?? []).map(async row => {
      const raw = (row as Record<string, unknown>)['raw_activity_items'] as Record<string, unknown>;

      // Contar candidatos desta actividade
      const { count: candCount } = await this.db
        .schema('staging')
        .from('venue_resolution_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('activity_staging_id', row.id);

      // Top candidato
      let topCandidateName: string | null = null;
      if (row.resolved_venue_staging_id) {
        const { data: venueData } = await this.db
          .schema('staging')
          .from('venues_staging')
          .select('name')
          .eq('id', row.resolved_venue_staging_id)
          .maybeSingle();
        topCandidateName = venueData?.name ?? null;
      }

      return {
        activityId:            row.id as string,
        productKey:            row.product_key as string,
        title:                 (raw?.['title'] as string | null) ?? null,
        venueMentionText:      (raw?.['venue_mention_raw_text'] as string | null) ?? null,
        venueMentionHint:      (raw?.['venue_mention_confidence_hint'] as string | null) ?? null,
        venueResolutionStatus: row.venue_resolution_status as string,
        resolutionConfidence:  row.resolution_confidence as number | null,
        topCandidateName,
        candidateCount:        candCount ?? 0,
        createdAt:             (row as Record<string, unknown>)['created_at'] as string ?? '',
      };
    }));

    return buildListResponse(items, count ?? 0, page, pageSize);
  }

  // ── Candidatos de uma actividade ───────────────────────────────────────────

  async listCandidates(activityId: string): Promise<ERCandidate[]> {
    const { data, error } = await this.db
      .schema('staging')
      .from('venue_resolution_candidates')
      .select('id, candidate_venue_id, score, name_score, geo_score, address_score, auto_classification, decision_outcome, match_detail')
      .eq('activity_staging_id', activityId)
      .order('score', { ascending: false });

    if (error) throw new Error(`listCandidates: ${error.message}`);
    if (!data || data.length === 0) return [];

    // Buscar detalhes dos venues numa segunda query
    const venueIds = [...new Set(data.map(r => r.candidate_venue_id as string))];
    const { data: venues } = await this.db
      .schema('staging')
      .from('venues_staging')
      .select('id, name, city')
      .in('id', venueIds);

    const venueMap = new Map((venues ?? []).map(v => [v.id as string, v]));

    return data.map((row, idx) => {
      const venue = venueMap.get(row.candidate_venue_id as string);
      return {
        id:                  row.id as string,
        candidateVenueId:    row.candidate_venue_id as string,
        venueName:           venue?.name ?? '',
        venueCity:           venue?.city ?? null,
        venueLat:            null,
        venueLng:            null,
        score:               row.score as number,
        nameScore:           row.name_score as number | null,
        geoScore:            row.geo_score as number | null,
        addressScore:        row.address_score as number | null,
        autoClassification:  row.auto_classification as string,
        decisionOutcome:     row.decision_outcome as string | null,
        matchDetail:         row.match_detail as Record<string, unknown> | null,
        rank:                idx + 1,
      };
    });
  }

  // ── Decisão: accept ────────────────────────────────────────────────────────

  async recordAccept(
    activityId:  string,
    candidateId: string,
    userId:      string,
    notes:       string | null,
    overrodeHighConfidence: boolean,
  ): Promise<void> {
    // 1. Verificar que o candidato pertence à actividade
    const { data: cand, error: candErr } = await this.db
      .schema('staging')
      .from('venue_resolution_candidates')
      .select('id, candidate_venue_id')
      .eq('id', candidateId)
      .eq('activity_staging_id', activityId)
      .maybeSingle();

    if (candErr || !cand) throw new Error(`Candidato ${candidateId} não encontrado para actividade ${activityId}`);

    // 2. Criar decisão
    const { data: decision, error: decErr } = await this.db
      .schema('staging')
      .from('venue_resolution_decisions')
      .insert({
        product_key:             (await this.getProductKey(activityId)),
        activity_staging_id:     activityId,
        action:                  'matched',
        accepted_candidate_id:   candidateId,
        user_id:                 userId,
        reviewed_at:             new Date().toISOString(),
        notes:                   notes ?? null,
        overrode_high_confidence: overrodeHighConfidence,
      })
      .select('id')
      .single();

    if (decErr || !decision) throw new Error(`Erro ao criar decisão: ${decErr?.message}`);

    // 3. Marcar candidato aceite
    await this.db.schema('staging').from('venue_resolution_candidates')
      .update({ decision_outcome: 'accepted', decision_id: decision.id })
      .eq('id', candidateId);

    // 4. Marcar outros candidatos como rejected
    await this.db.schema('staging').from('venue_resolution_candidates')
      .update({ decision_outcome: 'rejected' })
      .eq('activity_staging_id', activityId)
      .neq('id', candidateId);

    // 5. Actualizar activity
    await this.db.schema('staging').from('activities_staging')
      .update({
        venue_resolution_status:   'matched',
        resolved_venue_staging_id: cand.candidate_venue_id,
        resolution_confidence:     null, // confirmado por humano
      })
      .eq('id', activityId);
  }

  // ── Decisão: propose-new ───────────────────────────────────────────────────

  async recordProposeNew(
    activityId: string,
    userId:     string,
    notes:      string | null,
  ): Promise<void> {
    const productKey = await this.getProductKey(activityId);

    // 1. Criar decisão
    await this.db.schema('staging').from('venue_resolution_decisions').insert({
      product_key:             productKey,
      activity_staging_id:     activityId,
      action:                  'proposed_new',
      accepted_candidate_id:   null,
      user_id:                 userId,
      reviewed_at:             new Date().toISOString(),
      notes:                   notes ?? null,
      overrode_high_confidence: false,
    });

    // 2. Marcar candidatos como skipped
    await this.db.schema('staging').from('venue_resolution_candidates')
      .update({ decision_outcome: 'skipped' })
      .eq('activity_staging_id', activityId);

    // 3. Actualizar activity
    await this.db.schema('staging').from('activities_staging')
      .update({
        venue_resolution_status:   'proposed_new',
        resolved_venue_staging_id: null,
      })
      .eq('id', activityId);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  async getStats(productKey: string): Promise<ERStats> {
    const { data, error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select('venue_resolution_status')
      .eq('product_key', productKey);

    if (error) throw new Error(`getStats: ${error.message}`);

    const counts = { matched: 0, ambiguous: 0, unresolved: 0, proposed_new: 0, no_mention: 0 };
    for (const row of data ?? []) {
      const s = row.venue_resolution_status as string;
      if (s in counts) counts[s as keyof typeof counts]++;
    }

    // Contar decisões humanas
    const { count: decided } = await this.db
      .schema('staging')
      .from('venue_resolution_decisions')
      .select('id', { count: 'exact', head: true })
      .eq('product_key', productKey);

    const total = (data ?? []).length;
    return { total, ...counts, decided: decided ?? 0 };
  }

  // ── Utilitário ─────────────────────────────────────────────────────────────

  private async getProductKey(activityId: string): Promise<string> {
    const { data } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select('product_key')
      .eq('id', activityId)
      .single();
    return data?.product_key ?? '';
  }
}
