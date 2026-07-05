import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReviewContext, ActivityStagingRow } from '../types/reviewTypes';
import { ALLOWED_TRANSITIONS } from '../types/reviewTypes';
import { parseListParams, buildListResponse, type ListResponse } from '../types/listTypes';
import { logger } from '../../lib/logger';

export interface ActivityListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  product_key?: string;
  venue_resolution?: string;
  source?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

const LIST_SELECT = `
  id, raw_activity_item_id, product_key,
  proposal_status, venue_resolution_status,
  reviewed_by, reviewed_at, promoted_at, promoted_activity_id, created_at,
  raw_activity_items!inner (
    title, description, source_key, image_url, external_url,
    venue_mention_raw_text, venue_mention_confidence_hint, occurrences
  )
`;

const DETAIL_SELECT = `
  id, raw_activity_item_id, product_key,
  proposal_status, venue_resolution_status,
  reviewed_by, reviewed_at, promoted_at, promoted_activity_id, created_at,
  raw_activity_items!inner (
    title, description, source_key, image_url, external_url,
    venue_mention_raw_text, venue_mention_confidence_hint,
    occurrences, raw_payload
  )
`;

function parseOccurrences(raw: unknown): ActivityStagingRow['occurrences'] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ActivityStagingRow['occurrences'];
  try { return JSON.parse(raw as string); } catch { return []; }
}

function flattenRow(data: Record<string, unknown>, includePayload = false): ActivityStagingRow {
  const raw = data['raw_activity_items'] as Record<string, unknown> | null ?? {};
  return {
    id:                      data['id'] as string,
    raw_activity_item_id:    data['raw_activity_item_id'] as string,
    product_key:             data['product_key'] as string,
    proposal_status:         data['proposal_status'] as ActivityStagingRow['proposal_status'],
    venue_resolution_status: data['venue_resolution_status'] as string,
    reviewed_by:             data['reviewed_by'] as string | null,
    reviewed_at:             data['reviewed_at'] as string | null,
    promoted_at:             data['promoted_at'] as string | null,
    promoted_activity_id:    data['promoted_activity_id'] as string | null,
    created_at:              data['created_at'] as string,
    title:                   raw['title'] as string,
    description:             raw['description'] as string | null,
    source_key:              raw['source_key'] as string,
    image_url:               raw['image_url'] as string | null,
    external_url:            raw['external_url'] as string | null,
    venue_mention_raw_text:  raw['venue_mention_raw_text'] as string | null,
    venue_mention_confidence_hint: raw['venue_mention_confidence_hint'] as string | null,
    occurrences:             parseOccurrences(raw['occurrences']),
    ...(includePayload ? { raw_payload: raw['raw_payload'] as Record<string, unknown> } : {}),
  };
}

export class ActivityReviewRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(query: ActivityListQuery): Promise<ListResponse<ActivityStagingRow>> {
    const { page, pageSize, offset, search, status, product_key, sort, order } =
      parseListParams(query as Record<string, string | undefined>);

    const validSorts: Record<string, string> = {
      created_at:  'created_at',
      reviewed_at: 'reviewed_at',
    };
    const sortCol = validSorts[sort] ?? 'created_at';

    let q = this.db
      .schema('staging')
      .from('activities_staging')
      .select(LIST_SELECT, { count: 'exact' })
      .order(sortCol, { ascending: order === 'asc' })
      .range(offset, offset + pageSize - 1);

    if (status)                  q = q.eq('proposal_status', status);
    if (product_key)             q = q.eq('product_key', product_key);
    if (query.venue_resolution)  q = q.eq('venue_resolution_status', query.venue_resolution);
    if (query.source)            q = q.eq('raw_activity_items.source_key', query.source);

    const { data, error, count } = await q;
    if (error) throw new Error(`ActivityReviewRepository.list: ${error.message}`);

    let items = (data ?? []).map(row => flattenRow(row as Record<string, unknown>));
    if (search) {
      const term = search.toLowerCase();
      items = items.filter(a => a.title?.toLowerCase().includes(term));
    }

    return buildListResponse(items, count ?? 0, page, pageSize);
  }

  async getById(id: string): Promise<ActivityStagingRow | null> {
    const { data, error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`ActivityReviewRepository.getById: ${error.message}`);
    }
    return flattenRow(data as Record<string, unknown>, true);
  }

  async updateStatus(id: string, ctx: ReviewContext): Promise<void> {
    const current = await this.getById(id);
    if (!current) throw new Error(`Activity ${id} não encontrada`);

    const transition = ALLOWED_TRANSITIONS[current.proposal_status];
    const nextStatus = transition?.[ctx.action];
    if (!nextStatus) throw new Error(`Transição inválida: ${current.proposal_status} → ${ctx.action}`);

    const { error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .update({ proposal_status: nextStatus, reviewed_by: ctx.reviewedBy, reviewed_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(`ActivityReviewRepository.updateStatus: ${error.message}`);
    logger.info({ id, action: ctx.action, nextStatus, reviewedBy: ctx.reviewedBy }, 'activity status atualizado');
  }

  async markPromoted(id: string, reviewedBy: string): Promise<void> {
    const { error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .update({ proposal_status: 'promoted', promoted_at: new Date().toISOString(), promoted_activity_id: null, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('proposal_status', 'approved');

    if (error) throw new Error(`ActivityReviewRepository.markPromoted: ${error.message}`);
    logger.info({ id, reviewedBy }, 'activity marcada como promoted (staging only)');
  }
}
