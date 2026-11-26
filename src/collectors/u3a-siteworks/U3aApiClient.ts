/**
 * Cliente da WP REST pública de um site u3a SiteWorks — SÓ GET (U2).
 * Tipos lidos: u3a_event, u3a_group, u3a_venue, u3a_group_category.
 * Paginação por X-WP-TotalPages; fetch injectável para testes.
 */

export type U3aPostType = 'u3a_event' | 'u3a_group' | 'u3a_venue' | 'u3a_group_category';

/** Só os campos que o collector usa. content.rendered é lido em memória pelos parsers e nunca guardado. */
export interface U3aWpItem {
  id: number;
  link?: string;
  slug?: string;
  modified_gmt?: string;
  title?: { rendered: string };
  content?: { rendered: string };
  name?: string; // taxonomias
  // u3a_event
  eventdate?: string;
  eventstarttime?: string;
  eventendtime?: string;
  eventcategory?: string[] | string;
  eventgroup?: string;
  // u3a_group
  u3a_group_category?: number[];
}

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export class U3aApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly maxPages = 20,
  ) {}

  async fetchAll(type: U3aPostType): Promise<U3aWpItem[]> {
    const out: U3aWpItem[] = [];
    for (let page = 1; page <= this.maxPages; page++) {
      const url = `${this.baseUrl}/wp-json/wp/v2/${type}?per_page=100&page=${page}`;
      const res = await this.fetchFn(url, { method: 'GET', headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`U3aApiClient: ${type} página ${page}: HTTP ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body)) throw new Error(`U3aApiClient: ${type} página ${page}: resposta não é uma lista`);
      out.push(...(body as U3aWpItem[]));
      const totalPages = Number(res.headers.get('x-wp-totalpages') ?? '1');
      if (!Number.isFinite(totalPages) || page >= totalPages) break;
    }
    return out;
  }
}
