import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReviewContext, VenueStagingRow, VenueStagingDetail } from '../types/reviewTypes';
import { ALLOWED_TRANSITIONS } from '../types/reviewTypes';
import { parseListParams, buildListResponse, type ListResponse } from '../types/listTypes';
import { logger } from '../../lib/logger';

export interface VenueListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  product_key?: string;
  city?: string;
  category?: string;
  source?: string;
  /** ADR-0022 — filtra por geographic_status ('inside_radius' | 'buffer_zone' | 'outside_region'). */
  geographic_status?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

/** SELECT para listagem — sem raw_payload (performance).
 *  name e city são colunas persistidas em venues_staging (migrations 0006 e 0007)
 *  para permitir filtro e busca server-side sem depender de JOIN.
 *  geographic_status é coluna própria (migration 0018, ADR-0022) —
 *  dimensão independente de proposal_status, nunca confundida com ela. */
const LIST_SELECT = `
  id, raw_venue_item_id, source_key, source_item_id, product_key,
  proposal_status, geographic_status, reviewed_by, reviewed_at, promoted_at, promoted_venue_id,
  created_at, city, name,
  raw_venue_items!inner (
    address, lat, lng, phone, website, image_url,
    google_types, google_business_status,
    source_category_hint, source_query_text, source_query_kind,
    opening_hours_raw
  )
`;

/** SELECT para detalhe — inclui raw_payload completo */
const DETAIL_SELECT = `
  id, raw_venue_item_id, source_key, source_item_id, product_key,
  proposal_status, geographic_status, reviewed_by, reviewed_at, promoted_at, promoted_venue_id,
  created_at, city,
  raw_venue_items!inner (
    name, address, lat, lng, phone, website, image_url,
    google_types, google_business_status,
    source_category_hint, source_query_text, source_query_kind,
    opening_hours_raw, raw_payload
  )
`;

function flattenRow(data: Record<string, unknown>, includePayload = false): VenueStagingRow {
  const raw = data['raw_venue_items'] as Record<string, unknown> | null ?? {};
  return {
    id:                    data['id'] as string,
    raw_venue_item_id:     data['raw_venue_item_id'] as string,
    source_key:            data['source_key'] as string,
    source_item_id:        data['source_item_id'] as string,
    product_key:           data['product_key'] as string,
    proposal_status:       data['proposal_status'] as VenueStagingRow['proposal_status'],
    geographic_status:     (data['geographic_status'] ?? null) as VenueStagingRow['geographic_status'],
    reviewed_by:           data['reviewed_by'] as string | null,
    reviewed_at:           data['reviewed_at'] as string | null,
    promoted_at:           data['promoted_at'] as string | null,
    promoted_venue_id:     data['promoted_venue_id'] as string | null,
    created_at:            data['created_at'] as string,
    city:                  data['city'] as string | undefined,
    name:                  (data['name'] ?? raw['name']) as string,  // preferência para coluna persistida
    address:               raw['address'] as string | undefined,
    lat:                   raw['lat'] as number,
    lng:                   raw['lng'] as number,
    phone:                 raw['phone'] as string | null,
    website:               raw['website'] as string | null,
    image_url:             raw['image_url'] as string | null,
    google_types:          raw['google_types'] as string[],
    google_business_status: raw['google_business_status'] as string | null,
    source_category_hint:  raw['source_category_hint'] as string,
    source_query_text:     raw['source_query_text'] as string,
    source_query_kind:     raw['source_query_kind'] as string,
    opening_hours_raw:     raw['opening_hours_raw'] as string | null,
    ...(includePayload ? { raw_payload: raw['raw_payload'] as Record<string, unknown> } : {}),
  };
}

export class VenueReviewRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(query: VenueListQuery): Promise<ListResponse<VenueStagingRow>> {
    const { page, pageSize, offset, search, status, product_key, sort, order } =
      parseListParams(query as Record<string, string | undefined>);

    // Colunas de ordenação válidas em venues_staging
    const validSorts: Record<string, string> = {
      created_at:  'created_at',
      reviewed_at: 'reviewed_at',
      promoted_at: 'promoted_at',
    };
    const sortCol = validSorts[sort] ?? 'created_at';

    let q = this.db
      .schema('staging')
      .from('venues_staging')
      .select(LIST_SELECT, { count: 'exact' })
      .order(sortCol, { ascending: order === 'asc' })
      .range(offset, offset + pageSize - 1);

    if (status)             q = q.eq('proposal_status', status);
    if (product_key)        q = q.eq('product_key', product_key);
    if (query.city)         q = q.ilike('city', `%${query.city}%`);
    if (query.source)       q = q.eq('source_key', query.source);
    // ADR-0022 — dimensão independente de proposal_status, mesmo padrão de filtro exacto (.eq)
    if (query.geographic_status) q = q.eq('geographic_status', query.geographic_status);
    // Busca server-side real — usa coluna name persistida (migration 0007)
    // com índice GIN trigram para ILIKE eficiente em toda a tabela
    if (search)       q = q.ilike('name', `%${search}%`);

    const { data, error, count } = await q;
    if (error) throw new Error(`VenueReviewRepository.list: ${error.message}`);

    const items = (data ?? []).map(row => flattenRow(row as Record<string, unknown>));
    return buildListResponse(items, count ?? 0, page, pageSize);
  }

  async getById(id: string): Promise<VenueStagingDetail | null> {
    const { data, error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`VenueReviewRepository.getById: ${error.message}`);
    }
    return flattenRow(data as Record<string, unknown>, true) as VenueStagingDetail;
  }

  async updateStatus(id: string, ctx: ReviewContext): Promise<void> {
    const current = await this.getById(id);
    if (!current) throw new Error(`Venue ${id} não encontrado`);

    const transition = ALLOWED_TRANSITIONS[current.proposal_status];
    const nextStatus = transition?.[ctx.action];
    if (!nextStatus) throw new Error(`Transição inválida: ${current.proposal_status} → ${ctx.action}`);

    const { error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .update({ proposal_status: nextStatus, reviewed_by: ctx.reviewedBy, reviewed_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(`VenueReviewRepository.updateStatus: ${error.message}`);
    logger.info({ id, action: ctx.action, nextStatus, reviewedBy: ctx.reviewedBy }, 'venue status atualizado');
  }

  async markPromoted(id: string, reviewedBy: string): Promise<void> {
    const { error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .update({ proposal_status: 'promoted', promoted_at: new Date().toISOString(), promoted_venue_id: null, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('proposal_status', 'approved');

    if (error) throw new Error(`VenueReviewRepository.markPromoted: ${error.message}`);
    logger.info({ id, reviewedBy }, 'venue marcado como promoted (staging only)');
  }
}
