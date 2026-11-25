/**
 * Catálogo de produção (Issue #52, Fase 1): tipos do contrato SÓ DE LEITURA.
 *
 * Espelham as colunas de public.activities / public.venues / public.categories
 * usadas hoje pelo admin legado (vivere-60plus-admin/index.html). As colunas
 * são uma allowlist fechada: nada fora desta lista é pedido à produção.
 */

export const CATALOG_ACCESS_LABEL = 'PRODUÇÃO — SOMENTE LEITURA' as const;

export type EngineStatus = 'active' | 'archived' | 'draft';
export const ENGINE_STATUSES: readonly EngineStatus[] = ['active', 'archived', 'draft'];

export interface CatalogVenueRef {
  id: string;
  name: string;
}

export interface CatalogActivity {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  venue_id: string | null;
  venue: CatalogVenueRef | null;
  schedule: string | null;
  price: number | null;
  is_free: boolean | null;
  is_sponsored: boolean | null;
  imagem_url: string | null;
  start_date: string | null;
  end_date: string | null;
  recurrence_type: string | null;
  recurrence_days: string[] | null;
  recurrence_time: string | null;
  phone: string | null;
  url: string | null;
  interested_count: number | null;
  created_at: string | null;
  source_key: string | null;
  product_key: string | null;
  engine_status: EngineStatus | null;
  engine_activity_id: string | null;
  last_published_at: string | null;
}

export interface CatalogVenue {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  opening_hours: string | null;
  image_url: string | null;
  phone: string | null;
  created_at: string | null;
  source_key: string | null;
  product_key: string | null;
  engine_status: EngineStatus | null;
  engine_venue_id: string | null;
  last_published_at: string | null;
}

export interface CatalogCategory {
  id: string;
  key: string;
  emoji: string;
  cor: string;
  label_pt: string;
  label_en: string;
}

/** Colunas pedidas à produção (allowlist). */
export const ACTIVITY_COLUMNS = [
  'id', 'title', 'description', 'category', 'venue_id', 'schedule', 'price', 'is_free', 'is_sponsored',
  'imagem_url', 'start_date', 'end_date', 'recurrence_type', 'recurrence_days', 'recurrence_time', 'phone',
  'url', 'interested_count', 'created_at', 'source_key', 'product_key', 'engine_status', 'engine_activity_id',
  'last_published_at',
] as const;
export const VENUE_COLUMNS = [
  'id', 'name', 'address', 'category', 'lat', 'lng', 'website', 'opening_hours', 'image_url', 'phone',
  'created_at', 'source_key', 'product_key', 'engine_status', 'engine_venue_id', 'last_published_at',
] as const;
export const CATEGORY_COLUMNS = ['id', 'key', 'emoji', 'cor', 'label_pt', 'label_en'] as const;

export type ActivitySort = 'created_at' | 'title' | 'start_date';
export type VenueSort = 'name' | 'created_at';

export interface CatalogPage {
  page: number;
  pageSize: number;
}

export interface ActivityQuery extends CatalogPage {
  search?: string;
  category?: string;
  venueId?: string;
  engineStatus?: EngineStatus;
  sort: ActivitySort;
  order: 'asc' | 'desc';
}

export interface VenueQuery extends CatalogPage {
  search?: string;
  category?: string;
  engineStatus?: EngineStatus;
  sort: VenueSort;
  order: 'asc' | 'desc';
}

export interface CatalogList<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/** Fonte do catálogo: só métodos de leitura, por desenho. */
export interface CatalogSource {
  readonly target: 'production' | 'fixture';
  listActivities(q: ActivityQuery): Promise<CatalogList<CatalogActivity>>;
  getActivity(id: string): Promise<CatalogActivity | null>;
  listVenues(q: VenueQuery): Promise<CatalogList<CatalogVenue>>;
  getVenue(id: string): Promise<CatalogVenue | null>;
  listCategories(): Promise<CatalogCategory[]>;
}

export class CatalogUpstreamError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CatalogUpstreamError';
  }
}
