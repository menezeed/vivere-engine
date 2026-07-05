/**
 * Contrato padronizado de listagem para todas as entidades da Vivere Platform.
 *
 * Qualquer endpoint de listagem (venues, activities, ingestion-runs, etc.)
 * usa este formato de resposta e aceita estes parâmetros de query.
 * O frontend nunca implementa paginação, busca ou ordenação — esses são
 * responsabilidade exclusiva do backend.
 */

export interface ListResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  product_key?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface VenueListParams extends ListParams {
  city?: string;
  category?: string;   // source_category_hint
  source?: string;     // source_key
}

export interface ActivityListParams extends ListParams {
  venue_resolution?: string;
  source?: string;
}

/** Extrai e valida parâmetros de listagem do query string do Hono. */
export function parseListParams(query: Record<string, string | undefined>): {
  page: number;
  pageSize: number;
  offset: number;
  search: string | undefined;
  status: string | undefined;
  product_key: string | undefined;
  sort: string;
  order: 'asc' | 'desc';
} {
  const page     = Math.max(1, Number(query['page'] ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(query['pageSize'] ?? 20)));
  const offset   = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    offset,
    search:      query['search']      || undefined,
    status:      query['status']      || undefined,
    product_key: query['product_key'] || undefined,
    sort:        query['sort']        ?? 'created_at',
    order:       (query['order'] === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
  };
}

export function buildListResponse<T>(
  items: T[],
  totalItems: number,
  page: number,
  pageSize: number,
): ListResponse<T> {
  return {
    items,
    page,
    pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize),
  };
}
