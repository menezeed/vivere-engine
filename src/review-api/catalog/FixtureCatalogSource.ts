/**
 * Catálogo SINTÉTICO (Issue #52): dados inventados para desenvolvimento da UI
 * e testes. Nenhum registo vem da produção. Os ids são fixos para os testes.
 */
import type {
  ActivityQuery, CatalogActivity, CatalogCategory, CatalogList, CatalogSource, CatalogVenue, VenueQuery,
} from './catalogTypes';

const V1 = '00000000-0000-4000-8000-0000000000a1';
const V2 = '00000000-0000-4000-8000-0000000000a2';

const CATEGORIES: CatalogCategory[] = [
  { id: '00000000-0000-4000-8000-0000000000c1', key: 'cultura', emoji: '🎭', cor: '#1B6B45', label_pt: 'Cultura', label_en: 'Culture' },
  { id: '00000000-0000-4000-8000-0000000000c2', key: 'esporte', emoji: '🏃', cor: '#1D4ED8', label_pt: 'Esporte', label_en: 'Sport' },
];

const VENUES: CatalogVenue[] = [
  { id: V1, name: 'Centro Cultural Exemplo', address: 'Rua Fictícia, 100', category: 'cultura', lat: -22.88, lng: -42.02,
    website: null, opening_hours: null, image_url: null, phone: null, created_at: '2026-07-01T10:00:00Z',
    source_key: 'legacy', product_key: 'legacy', engine_status: 'active', engine_venue_id: null, last_published_at: null },
  { id: V2, name: 'Praça Sintética', address: null, category: null, lat: null, lng: null,
    website: null, opening_hours: null, image_url: null, phone: null, created_at: '2026-07-02T10:00:00Z',
    source_key: 'legacy', product_key: 'legacy', engine_status: 'draft', engine_venue_id: null, last_published_at: null },
];

const base = {
  description: null, schedule: null, imagem_url: null, end_date: null, phone: null, url: null, interested_count: 0,
  source_key: 'legacy', product_key: 'legacy', engine_activity_id: null, last_published_at: null, is_sponsored: false,
} as const;

const ACTIVITIES: CatalogActivity[] = [
  { ...base, id: '00000000-0000-4000-8000-000000000001', title: 'Oficina de teatro (exemplo)', category: 'cultura',
    venue_id: V1, venue: { id: V1, name: VENUES[0]!.name }, price: 0, is_free: true, start_date: '2026-12-05T18:00:00Z',
    recurrence_type: 'none', recurrence_days: [], recurrence_time: null, created_at: '2026-11-01T10:00:00Z', engine_status: 'active' },
  { ...base, id: '00000000-0000-4000-8000-000000000002', title: 'Caminhada semanal (exemplo)', category: 'esporte',
    venue_id: V2, venue: { id: V2, name: VENUES[1]!.name }, price: 0, is_free: false, start_date: null,
    recurrence_type: 'weekly', recurrence_days: ['sat'], recurrence_time: '07:00', created_at: '2026-11-02T10:00:00Z', engine_status: 'active' },
  { ...base, id: '00000000-0000-4000-8000-000000000003', title: 'Registo incompleto (exemplo)', category: 'inexistente',
    venue_id: null, venue: null, price: 0, is_free: false, start_date: null,
    recurrence_type: 'none', recurrence_days: null, recurrence_time: null, created_at: '2026-11-03T10:00:00Z', engine_status: 'draft' },
];

function paginate<T>(rows: T[], page: number, pageSize: number): CatalogList<T> {
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), page, pageSize, totalItems: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) };
}

function cmp(a: unknown, b: unknown, order: 'asc' | 'desc'): number {
  const r = a === b ? 0 : a === null || a === undefined ? 1 : b === null || b === undefined ? -1 : String(a) < String(b) ? -1 : 1;
  return order === 'asc' ? r : -r;
}

export class FixtureCatalogSource implements CatalogSource {
  readonly target = 'fixture' as const;

  async listActivities(q: ActivityQuery): Promise<CatalogList<CatalogActivity>> {
    const s = q.search?.toLowerCase();
    const rows = ACTIVITIES.filter((a) => (!s || a.title.toLowerCase().includes(s))
      && (!q.category || a.category === q.category) && (!q.venueId || a.venue_id === q.venueId)
      && (!q.engineStatus || a.engine_status === q.engineStatus))
      .sort((a, b) => cmp(a[q.sort], b[q.sort], q.order));
    return paginate(rows, q.page, q.pageSize);
  }

  async getActivity(id: string): Promise<CatalogActivity | null> { return ACTIVITIES.find((a) => a.id === id) ?? null; }

  async listVenues(q: VenueQuery): Promise<CatalogList<CatalogVenue>> {
    const s = q.search?.toLowerCase();
    const rows = VENUES.filter((v) => (!s || v.name.toLowerCase().includes(s))
      && (!q.category || v.category === q.category) && (!q.engineStatus || v.engine_status === q.engineStatus))
      .sort((a, b) => cmp(a[q.sort], b[q.sort], q.order));
    return paginate(rows, q.page, q.pageSize);
  }

  async getVenue(id: string): Promise<CatalogVenue | null> { return VENUES.find((v) => v.id === id) ?? null; }

  async listCategories(): Promise<CatalogCategory[]> { return [...CATEGORIES]; }
}
