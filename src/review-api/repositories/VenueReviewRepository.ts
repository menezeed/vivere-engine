import type { SupabaseClient } from '@supabase/supabase-js';
import type { IVenueReviewRepository } from '../../persistence/types/repositoryInterfaces';
import type { ReviewFilter, ReviewContext, VenueStagingRow } from '../types/reviewTypes';
import { ALLOWED_TRANSITIONS } from '../types/reviewTypes';
import { logger } from '../../lib/logger';

export class VenueReviewRepository implements IVenueReviewRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(filter: ReviewFilter): Promise<VenueStagingRow[]> {
    let query = this.db
      .schema('staging')
      .from('venues_staging')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(filter.limit ?? 20)
      .range(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 20) - 1);

    if (filter.status)      query = query.eq('proposal_status', filter.status);
    if (filter.product_key) query = query.eq('product_key', filter.product_key);

    const { data, error } = await query;
    if (error) throw new Error(`VenueReviewRepository.list: ${error.message}`);
    return (data ?? []) as VenueStagingRow[];
  }

  async getById(id: string): Promise<VenueStagingRow | null> {
    // JOIN com raw_venue_items para trazer os campos do dado bruto
    const { data, error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .select(`
        *,
        raw_venue_items!inner (
          name, address, lat, lng, phone, website,
          google_types, source_category_hint
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // not found
      throw new Error(`VenueReviewRepository.getById: ${error.message}`);
    }

    // Flatten do JOIN
    const raw = (data as Record<string, unknown>)['raw_venue_items'] as Record<string, unknown>;
    return {
      ...(data as VenueStagingRow),
      name:                 raw?.['name'] as string,
      address:              raw?.['address'] as string,
      lat:                  raw?.['lat'] as number,
      lng:                  raw?.['lng'] as number,
      phone:                raw?.['phone'] as string | null,
      website:              raw?.['website'] as string | null,
      google_types:         raw?.['google_types'] as string[],
      source_category_hint: raw?.['source_category_hint'] as string,
    };
  }

  async updateStatus(id: string, ctx: ReviewContext): Promise<void> {
    const current = await this.getById(id);
    if (!current) throw new Error(`Venue ${id} não encontrado`);

    const transition = ALLOWED_TRANSITIONS[current.proposal_status];
    const nextStatus = transition?.[ctx.action];
    if (!nextStatus) {
      throw new Error(
        `Transição inválida: ${current.proposal_status} → ${ctx.action}`,
      );
    }

    const { error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .update({
        proposal_status: nextStatus,
        reviewed_by:     ctx.reviewedBy,
        reviewed_at:     new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw new Error(`VenueReviewRepository.updateStatus: ${error.message}`);

    logger.info({ id, action: ctx.action, nextStatus, reviewedBy: ctx.reviewedBy }, 'venue status atualizado');
  }

  async markPromoted(id: string, reviewedBy: string): Promise<void> {
    const { error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .update({
        proposal_status:  'promoted',
        promoted_at:      new Date().toISOString(),
        promoted_venue_id: null, // Opção A: promoção fictícia — sem escrita em public.venues
        reviewed_by:      reviewedBy,
        reviewed_at:      new Date().toISOString(),
      })
      .eq('id', id)
      .eq('proposal_status', 'approved'); // só promove se estiver approved

    if (error) throw new Error(`VenueReviewRepository.markPromoted: ${error.message}`);

    logger.info({ id, reviewedBy }, 'venue marcado como promoted (staging only)');
  }
}
