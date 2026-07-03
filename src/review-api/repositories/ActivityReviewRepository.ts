import type { SupabaseClient } from '@supabase/supabase-js';
import type { IActivityReviewRepository } from '../../persistence/types/repositoryInterfaces';
import type { ReviewFilter, ReviewContext, ActivityStagingRow } from '../types/reviewTypes';
import { ALLOWED_TRANSITIONS } from '../types/reviewTypes';
import { logger } from '../../lib/logger';

export class ActivityReviewRepository implements IActivityReviewRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(filter: ReviewFilter): Promise<ActivityStagingRow[]> {
    let query = this.db
      .schema('staging')
      .from('activities_staging')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(filter.limit ?? 20)
      .range(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 20) - 1);

    if (filter.status)      query = query.eq('proposal_status', filter.status);
    if (filter.product_key) query = query.eq('product_key', filter.product_key);

    const { data, error } = await query;
    if (error) throw new Error(`ActivityReviewRepository.list: ${error.message}`);
    return (data ?? []) as ActivityStagingRow[];
  }

  async getById(id: string): Promise<ActivityStagingRow | null> {
    const { data, error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select(`
        *,
        raw_activity_items!inner (
          title, description, venue_mention_raw_text
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`ActivityReviewRepository.getById: ${error.message}`);
    }

    const raw = (data as Record<string, unknown>)['raw_activity_items'] as Record<string, unknown>;
    return {
      ...(data as ActivityStagingRow),
      title:                  raw?.['title'] as string,
      description:            raw?.['description'] as string | null,
      venue_mention_raw_text: raw?.['venue_mention_raw_text'] as string | null,
    };
  }

  async updateStatus(id: string, ctx: ReviewContext): Promise<void> {
    const current = await this.getById(id);
    if (!current) throw new Error(`Activity ${id} não encontrada`);

    const transition = ALLOWED_TRANSITIONS[current.proposal_status];
    const nextStatus = transition?.[ctx.action];
    if (!nextStatus) {
      throw new Error(`Transição inválida: ${current.proposal_status} → ${ctx.action}`);
    }

    const { error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .update({
        proposal_status: nextStatus,
        reviewed_by:     ctx.reviewedBy,
        reviewed_at:     new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw new Error(`ActivityReviewRepository.updateStatus: ${error.message}`);

    logger.info({ id, action: ctx.action, nextStatus, reviewedBy: ctx.reviewedBy }, 'activity status atualizado');
  }

  async markPromoted(id: string, reviewedBy: string): Promise<void> {
    const { error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .update({
        proposal_status:      'promoted',
        promoted_at:          new Date().toISOString(),
        promoted_activity_id: null, // Opção A: promoção fictícia
        reviewed_by:          reviewedBy,
        reviewed_at:          new Date().toISOString(),
      })
      .eq('id', id)
      .eq('proposal_status', 'approved');

    if (error) throw new Error(`ActivityReviewRepository.markPromoted: ${error.message}`);

    logger.info({ id, reviewedBy }, 'activity marcada como promoted (staging only)');
  }
}
