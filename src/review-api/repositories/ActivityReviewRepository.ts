import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReviewContext, ActivityStagingRow } from '../types/reviewTypes';
import { ALLOWED_TRANSITIONS } from '../types/reviewTypes';
import { parseListParams, buildListResponse, ilikeContains, type ListResponse } from '../types/listTypes';
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
  /**
   * Issue #62: filtro por source_item_id calculado a partir da auditoria de
   * elegibilidade. Aplicado no servidor, antes do range, para a paginação
   * reflectir o filtro.
   */
  /** Filtro de elegibilidade: mesma chave da classificação (fonte + id + URL). */
  source_item_ids?: { mode: 'in' | 'not_in'; source_key: string; ids: string[]; urls: string[] };
}

/** Valor PostgREST entre aspas (para filtros dentro de or()). */
function postgrestValue(v: string): string {
  return `"${v.replace(/["\\]/g, '')}"`;
}

/** Lista PostgREST para `not.in.(...)`: valores entre aspas (contêm ':'). */
function postgrestInList(ids: string[]): string {
  return `(${ids.map(v => `"${v.replace(/["\\]/g, '')}"`).join(',')})`;
}

const LIST_SELECT = `
  id, raw_activity_item_id, product_key,
  proposal_status, venue_resolution_status,
  reviewed_by, reviewed_at, promoted_at, promoted_activity_id, created_at,
  raw_activity_items!inner (
    title, description, source_key, source_item_id, image_url, external_url,
    venue_mention_raw_text, venue_mention_confidence_hint, occurrences
  )
`;

const DETAIL_SELECT = `
  id, raw_activity_item_id, product_key,
  proposal_status, venue_resolution_status,
  reviewed_by, reviewed_at, promoted_at, promoted_activity_id, created_at,
  raw_activity_items!inner (
    title, description, source_key, source_item_id, image_url, external_url,
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
    source_item_id:          (raw['source_item_id'] as string | undefined) ?? null,
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
      // Desempate estável (Issue #60): ingestões em lote dão created_at repetido
      // (133 linhas UK com 3 valores) e o OFFSET repetia/saltava linhas entre páginas.
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (status)                  q = q.eq('proposal_status', status);
    if (product_key)             q = q.eq('product_key', product_key);
    if (query.venue_resolution)  q = q.eq('venue_resolution_status', query.venue_resolution);
    if (query.source)            q = q.eq('raw_activity_items.source_key', query.source);
    // Pesquisa por título NO SERVIDOR (o embed é !inner, logo o filtro
    // restringe as linhas-pai, como o de source acima). Antes filtrava em
    // memória só a página já cortada por .range(): a pesquisa ignorava as
    // outras páginas e totalItems/totalPages não reflectiam o filtro.
    if (search)                  q = q.ilike('raw_activity_items.title', ilikeContains(search));
    const idf = query.source_item_ids;
    if (idf) {
      // Lista vazia com 'in' → nenhuma linha (sem ir à base).
      if (idf.mode === 'in' && idf.ids.length === 0) return buildListResponse([], 0, page, pageSize);
      if (idf.mode === 'in') {
        q = q.eq('raw_activity_items.source_key', idf.source_key)
          .in('raw_activity_items.source_item_id', idf.ids)
          .in('raw_activity_items.external_url', idf.urls);
      } else if (idf.ids.length > 0) {
        // NOT (fonte = S AND id IN E AND url IN U) — exclui só as linhas que casam.
        q = q.or(
          `source_key.neq.${postgrestValue(idf.source_key)},source_item_id.not.in.${postgrestInList(idf.ids)},external_url.not.in.${postgrestInList(idf.urls)}`,
          { referencedTable: 'raw_activity_items' },
        );
      }
    }

    const { data, error, count } = await q;
    if (error) throw new Error(`ActivityReviewRepository.list: ${error.message}`);

    const items = (data ?? []).map(row => flattenRow(row as Record<string, unknown>));

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
