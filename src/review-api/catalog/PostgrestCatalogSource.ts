/**
 * Catálogo de produção (Issue #52, Fase 1): leitura via PostgREST, SÓ GET.
 *
 * Garantias por construção:
 *   - o único método HTTP emitido é GET (verificado antes de cada pedido);
 *   - só as tabelas activities / venues / categories e só as colunas da
 *     allowlist (catalogTypes.ts);
 *   - autenticação só com a chave publishable/anon (validada em catalogConfig);
 *     o token do utilizador do Admin NUNCA é reencaminhado para a produção;
 *   - filtros validados (UUID, enum) e pesquisa sanitizada antes de entrar
 *     na query string do PostgREST.
 * As políticas de produção dão SELECT público a estas três tabelas
 * (auditoria do backup v5 de 23/11), por isso não é precisa nenhuma chave
 * privilegiada para ler o catálogo.
 */
import { UUID_RE } from '../middleware/uuidParam';
import {
  ACTIVITY_COLUMNS, CATEGORY_COLUMNS, VENUE_COLUMNS, CatalogUpstreamError, ENGINE_STATUSES,
  type ActivityQuery, type CatalogActivity, type CatalogCategory, type CatalogList, type CatalogSource,
  type CatalogVenue, type VenueQuery,
} from './catalogTypes';

type Table = 'activities' | 'venues' | 'categories';
const TABLES: ReadonlySet<Table> = new Set(['activities', 'venues', 'categories']);

export interface PostgrestCatalogSourceOptions {
  baseUrl: string;
  publishableKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Remove caracteres com significado na sintaxe do PostgREST e limita o tamanho. */
export function sanitizeSearch(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/[*%,()."'\\:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned === '' ? undefined : cleaned;
}

const ACTIVITY_SELECT = [...ACTIVITY_COLUMNS, 'venue:venues(id,name)'].join(',');

export class PostgrestCatalogSource implements CatalogSource {
  readonly target = 'production' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: PostgrestCatalogSourceOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private headers(withCount: boolean, range?: [number, number]): Record<string, string> {
    const h: Record<string, string> = { apikey: this.opts.publishableKey, Accept: 'application/json' };
    // JWT anon legado: o PostgREST também o espera em Authorization. Uma chave
    // sb_publishable_ vai só em apikey. Nunca um token de utilizador.
    if (this.opts.publishableKey.startsWith('eyJ')) h['Authorization'] = `Bearer ${this.opts.publishableKey}`;
    if (withCount) h['Prefer'] = 'count=exact';
    if (range) { h['Range-Unit'] = 'items'; h['Range'] = `${range[0]}-${range[1]}`; }
    return h;
  }

  private async get(table: Table, params: URLSearchParams, withCount: boolean, range?: [number, number]): Promise<{ rows: unknown[]; total: number | null }> {
    if (!TABLES.has(table)) throw new Error(`tabela fora da allowlist: ${table}`);
    const url = `${this.opts.baseUrl}/rest/v1/${table}?${params.toString()}`;
    const method = 'GET';
    const res = await this.fetchImpl(url, { method, headers: this.headers(withCount, range), signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok && res.status !== 206) {
      throw new CatalogUpstreamError(res.status, `catálogo de produção respondeu HTTP ${res.status} em ${table}`);
    }
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) throw new CatalogUpstreamError(502, `resposta inesperada do catálogo em ${table}`);
    const cr = res.headers.get('content-range');
    const total = cr && /\/(\d+)$/.test(cr) ? Number(/\/(\d+)$/.exec(cr)?.[1]) : null;
    return { rows, total };
  }

  private page<T>(rows: unknown[], total: number | null, page: number, pageSize: number): CatalogList<T> {
    const totalItems = total ?? rows.length;
    return { items: rows as T[], page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) };
  }

  async listActivities(q: ActivityQuery): Promise<CatalogList<CatalogActivity>> {
    const p = new URLSearchParams({ select: ACTIVITY_SELECT, order: `${q.sort}.${q.order}.nullslast` });
    const search = sanitizeSearch(q.search);
    if (search) p.set('title', `ilike.*${search}*`);
    if (q.category) p.set('category', `eq.${q.category}`);
    if (q.venueId) {
      if (!UUID_RE.test(q.venueId)) throw new CatalogUpstreamError(400, 'venue_id inválido');
      p.set('venue_id', `eq.${q.venueId}`);
    }
    if (q.engineStatus) {
      if (!ENGINE_STATUSES.includes(q.engineStatus)) throw new CatalogUpstreamError(400, 'engine_status inválido');
      p.set('engine_status', `eq.${q.engineStatus}`);
    }
    const from = (q.page - 1) * q.pageSize;
    const { rows, total } = await this.get('activities', p, true, [from, from + q.pageSize - 1]);
    return this.page<CatalogActivity>(rows, total, q.page, q.pageSize);
  }

  async getActivity(id: string): Promise<CatalogActivity | null> {
    if (!UUID_RE.test(id)) return null;
    const { rows } = await this.get('activities', new URLSearchParams({ select: ACTIVITY_SELECT, id: `eq.${id}`, limit: '1' }), false);
    return (rows[0] as CatalogActivity | undefined) ?? null;
  }

  async listVenues(q: VenueQuery): Promise<CatalogList<CatalogVenue>> {
    const p = new URLSearchParams({ select: VENUE_COLUMNS.join(','), order: `${q.sort}.${q.order}.nullslast` });
    const search = sanitizeSearch(q.search);
    if (search) p.set('name', `ilike.*${search}*`);
    if (q.category) p.set('category', `eq.${q.category}`);
    if (q.engineStatus) {
      if (!ENGINE_STATUSES.includes(q.engineStatus)) throw new CatalogUpstreamError(400, 'engine_status inválido');
      p.set('engine_status', `eq.${q.engineStatus}`);
    }
    const from = (q.page - 1) * q.pageSize;
    const { rows, total } = await this.get('venues', p, true, [from, from + q.pageSize - 1]);
    return this.page<CatalogVenue>(rows, total, q.page, q.pageSize);
  }

  async getVenue(id: string): Promise<CatalogVenue | null> {
    if (!UUID_RE.test(id)) return null;
    const { rows } = await this.get('venues', new URLSearchParams({ select: VENUE_COLUMNS.join(','), id: `eq.${id}`, limit: '1' }), false);
    return (rows[0] as CatalogVenue | undefined) ?? null;
  }

  async listCategories(): Promise<CatalogCategory[]> {
    const { rows } = await this.get('categories', new URLSearchParams({ select: CATEGORY_COLUMNS.join(','), order: 'label_pt.asc' }), false);
    return rows as CatalogCategory[];
  }
}
