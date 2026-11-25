import { ApiError, apiRequest } from '../api/client';
import type { CatalogActivity, CatalogCategory, CatalogList, CatalogVenue, EngineStatus } from '../../../src/review-api/catalog/catalogTypes';
import type { ActivityGap, Completeness, VenueGap } from '../../../src/review-api/catalog/completeness';

export type CatalogKind = 'activities' | 'venues';
export type CatalogRow = (CatalogActivity & { completeness: Completeness<ActivityGap> })
  | (CatalogVenue & { completeness: Completeness<VenueGap> });
export interface CatalogFilters {
  search: string;
  category: string;
  status: EngineStatus | '';
  venueId: string;
  page: number;
}

type FixtureEnvironment = { target: 'fixture'; access: 'read-only'; label: string };
type ReadRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export function createCatalogClient(request: ReadRequest = apiRequest) {
  async function read<T>(path: string, query: URLSearchParams, signal?: AbortSignal) {
    query.set('expected_target', 'fixture');
    const result = await request<T & { environment: FixtureEnvironment }>(`/api/catalog/${path}?${query}`, {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
    });
    if (result?.environment?.target !== 'fixture' || result.environment.access !== 'read-only' ||
        result.environment.label !== 'DADOS SINTÉTICOS — SOMENTE LEITURA') {
      throw new ApiError(503, { code: 'CATALOG_TARGET_MISMATCH' });
    }
    return result;
  }

  return {
    list(kind: CatalogKind, filters: CatalogFilters, signal?: AbortSignal, pageSize = 25) {
      const query = new URLSearchParams({ page: String(filters.page), pageSize: String(pageSize) });
      if (filters.search.trim()) query.set('search', filters.search.trim());
      if (filters.category) query.set('category', filters.category);
      if (filters.status) query.set('engine_status', filters.status);
      if (kind === 'activities' && filters.venueId.trim()) query.set('venue_id', filters.venueId.trim());
      return read<CatalogList<CatalogRow>>(kind, query, signal);
    },
    detail(kind: CatalogKind, id: string, signal?: AbortSignal) {
      if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) throw new ApiError(400, null);
      return read<{ data: CatalogRow }>(`${kind}/${id}`, new URLSearchParams(), signal);
    },
    categories(signal?: AbortSignal) {
      return read<{ items: CatalogCategory[] }>('categories', new URLSearchParams(), signal);
    },
  };
}

export function catalogError(error: unknown) {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400: return 'Revise os filtros informados.';
      case 401: return 'Inicie sessão novamente.';
      case 403: return 'A sua conta não tem permissão para consultar o catálogo.';
      case 404: return 'Registro indisponível.';
      case 503: return 'Catálogo sintético desativado ou em ambiente incompatível.';
    }
  }
  return 'Catálogo indisponível. Tente novamente mais tarde.';
}

export const catalogClient = createCatalogClient();
