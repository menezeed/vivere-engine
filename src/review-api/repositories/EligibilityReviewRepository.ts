/**
 * staging.activity_eligibility_reviews (migração 0033). Só SELECT e INSERT:
 * append-only, a trilha de auditoria nunca é alterada nem apagada pelo runtime.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EligibilityReviewInput, EligibilityReviewRow } from '../eligibility/humanReview';

const COLUMNS = `id, activity_staging_id, product_key, source_key, source_item_id, external_url,
  classification, confidence, evidence_text, evidence_url, audience, membership_required, booking,
  availability, additional_costs, verified_at, notes, reviewed_by, reviewed_role, reviewed_at`;

export interface NewEligibilityReview extends EligibilityReviewInput {
  activity_staging_id: string;
  product_key: string;
  source_key: string;
  source_item_id: string;
  external_url: string | null;
  reviewed_by: string;
  reviewed_role: 'reviewer' | 'admin';
}

export interface IEligibilityReviewRepository {
  listByActivity(activityId: string): Promise<EligibilityReviewRow[]>;
  latestByActivityIds(activityIds: readonly string[]): Promise<Map<string, EligibilityReviewRow>>;
  insert(review: NewEligibilityReview): Promise<EligibilityReviewRow>;
}

export class EligibilityReviewRepository implements IEligibilityReviewRepository {
  constructor(private readonly db: SupabaseClient) {}

  private table() { return this.db.schema('staging').from('activity_eligibility_reviews'); }

  /** Histórico completo de uma actividade, mais recente primeiro. */
  async listByActivity(activityId: string): Promise<EligibilityReviewRow[]> {
    const { data, error } = await this.table().select(COLUMNS)
      .eq('activity_staging_id', activityId)
      .order('reviewed_at', { ascending: false }).order('id', { ascending: false }).limit(200);
    if (error) throw new Error(`EligibilityReviewRepository.listByActivity: ${error.message}`);
    return (data ?? []) as unknown as EligibilityReviewRow[];
  }

  /** Última revisão de cada actividade (para a página da lista). */
  async latestByActivityIds(activityIds: readonly string[]): Promise<Map<string, EligibilityReviewRow>> {
    const out = new Map<string, EligibilityReviewRow>();
    if (activityIds.length === 0) return out;
    const { data, error } = await this.table().select(COLUMNS)
      .in('activity_staging_id', [...activityIds])
      .order('reviewed_at', { ascending: false }).order('id', { ascending: false }).limit(1000);
    if (error) throw new Error(`EligibilityReviewRepository.latestByActivityIds: ${error.message}`);
    for (const r of (data ?? []) as unknown as EligibilityReviewRow[]) {
      if (!out.has(r.activity_staging_id)) out.set(r.activity_staging_id, r);
    }
    return out;
  }

  async insert(review: NewEligibilityReview): Promise<EligibilityReviewRow> {
    const { data, error } = await this.table().insert(review).select(COLUMNS).single();
    if (error) throw new Error(`EligibilityReviewRepository.insert: ${error.message}`);
    return data as unknown as EligibilityReviewRow;
  }
}
