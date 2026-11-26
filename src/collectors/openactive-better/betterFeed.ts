/**
 * Better OpenActive — leitura limitada do RPDE e snapshot (piloto UK).
 *
 * readFeed(): segue `next` até itens vazios ou next == url, com no máximo
 * BETTER_CONFIG.max_requests_per_run pedidos, 3 s entre pedidos, e PÁRA em
 * HTTP 429/403. Cada página é reduzida de imediato às séries de Richmond
 * (RichmondAccumulator): o feed nacional nunca é guardado.
 *
 * parseBetterSnapshot(): valida o snapshot do preview antes da ingestão
 * (0 pedidos HTTP na ingestão).
 */
import { BETTER_CONFIG } from './config';
import { RichmondAccumulator, UK_POSTCODE, WEEKDAYS, PERSONAL, isRichmondPostcode, type BetterSeries, type RpdeItem } from './betterSeries';

export type FetchJson = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface FeedReadResult {
  series: BetterSeries[];
  requests: number;
  pages_with_items: number;
  items_read: number;
  deleted_read: number;
  complete: boolean;
  stop_reason: 'end_of_feed' | 'request_limit' | 'http_429' | 'http_403' | 'foreign_next_url';
}

export interface ReadFeedOptions {
  fetchJson: FetchJson;
  sleep?: (ms: number) => Promise<void>;
  maxRequests?: number;
  intervalMs?: number;
  startUrl?: string;
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function readFeed(opts: ReadFeedOptions): Promise<FeedReadResult> {
  const max = Math.min(opts.maxRequests ?? BETTER_CONFIG.max_requests_per_run, BETTER_CONFIG.max_requests_per_run);
  const interval = Math.max(opts.intervalMs ?? BETTER_CONFIG.min_interval_ms, BETTER_CONFIG.min_interval_ms);
  const sleep = opts.sleep ?? defaultSleep;
  const acc = new RichmondAccumulator();
  let url = opts.startUrl ?? BETTER_CONFIG.feed_url;
  let requests = 0;
  let pages = 0;
  const done = (complete: boolean, stop_reason: FeedReadResult['stop_reason']): FeedReadResult =>
    ({ series: acc.series(), requests, pages_with_items: pages, items_read: acc.items_read, deleted_read: acc.deleted_read, complete, stop_reason });

  while (requests < max) {
    if (requests > 0) await sleep(interval);
    requests++;
    const res = await opts.fetchJson(url, { headers: { 'User-Agent': BETTER_CONFIG.user_agent, Accept: 'application/json' } });
    if (res.status === 429) return done(false, 'http_429');
    if (res.status === 403) return done(false, 'http_403');
    if (res.status !== 200) throw new Error(`feed: HTTP ${res.status} em ${url}`);
    const page = (await res.json()) as { items?: unknown; next?: unknown };
    const items = Array.isArray(page.items) ? page.items as RpdeItem[] : [];
    if (items.length > 0) { pages++; acc.add(items); }
    const next = typeof page.next === 'string' ? new URL(page.next, url).toString() : null;
    if (items.length === 0 || next === null || next === url) return done(true, 'end_of_feed');
    if (!next.startsWith(`${BETTER_CONFIG.feed_url}`)) return done(false, 'foreign_next_url');
    url = next;
  }
  return done(false, 'request_limit');
}

/** Leitura offline de páginas RPDE guardadas (ordem: nome do ficheiro). */
export function readFeedPages(pages: readonly unknown[]): Omit<FeedReadResult, 'requests' | 'stop_reason'> & { stop_reason: 'offline' } {
  const acc = new RichmondAccumulator();
  let n = 0;
  for (const p of pages) {
    const items = Array.isArray((p as { items?: unknown })?.items) ? (p as { items: RpdeItem[] }).items : [];
    if (items.length) { n++; acc.add(items); }
  }
  return { series: acc.series(), pages_with_items: n, items_read: acc.items_read, deleted_read: acc.deleted_read, complete: true, stop_reason: 'offline' };
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

export interface BetterSnapshot {
  gerado_em: string;
  hoje: string;
  dry_run: true;
  escrita_em_bd: false;
  fonte: {
    source_key: string;
    feed_url: string;
    pedidos_http: number;
    paginas_com_itens: number;
    itens_lidos: number;
    itens_apagados_lidos: number;
    feed_completo: boolean;
    paragem: string;
  };
  produto: string;
  licenca: { name: string; url: string; attribution: string };
  series: BetterSeries[];
  [k: string]: unknown;
}

const isNumOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function assertSeries(s: BetterSeries): void {
  const id = s?.identifier;
  const fail = (m: string) => { throw new Error(`snapshot: ${m} (${String(id)})`); };
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) fail('identifier inválido');
  if (typeof s.name !== 'string' || !s.name.trim()) fail('nome vazio');
  if (s.url !== null && (typeof s.url !== 'string' || !/^https:\/\/(www\.)?better\.org\.uk\/[A-Za-z0-9\-/_.]{0,200}$/.test(s.url))) fail('URL fora do site oficial');
  if (!Array.isArray(s.activities) || !s.activities.every(a => typeof a === 'string')) fail('activities inválidas');
  if (s.age_range !== null && (!s.age_range || !isNumOrNull(s.age_range.min) || !isNumOrNull(s.age_range.max))) fail('age_range inválido');
  if (!Array.isArray(s.offers) || !s.offers.every(o => o && isStrOrNull(o.name) && isNumOrNull(o.price) && isStrOrNull(o.currency) && isNumOrNull(o.age_min) && isNumOrNull(o.age_max))) fail('offers inválidas');
  const l = s.location;
  if (!l || typeof l.name !== 'string' || !isStrOrNull(l.street) || !isStrOrNull(l.locality) || typeof l.postcode !== 'string' || !UK_POSTCODE.test(l.postcode)) fail('local inválido');
  if (!isRichmondPostcode(l.postcode)) fail('código postal fora de Richmond');
  if (!Array.isArray(s.schedules)) fail('schedules em falta');
  for (const x of s.schedules) {
    if (!Array.isArray(x.by_day) || !x.by_day.every(d => (WEEKDAYS as readonly string[]).includes(d))) fail('byDay inválido');
    for (const t of [x.start_time, x.end_time]) if (t !== null && !TIME.test(String(t))) fail('hora inválida');
    for (const d of [x.start_date, x.end_date, ...(x.except_dates ?? [])]) if (d !== null && !DATE.test(String(d))) fail('data inválida');
    if (!isStrOrNull(x.repeat_frequency) || !isStrOrNull(x.timezone)) fail('schedule inválido');
  }
  // Allowlist: nenhuma chave extra (ex.: description, leader) pode entrar pelo JSON.
  const allowed = new Set(['identifier', 'rpde_modified', 'name', 'url', 'activities', 'age_range', 'offers', 'location', 'schedules']);
  if (Object.keys(s).some(k => !allowed.has(k))) fail('campo fora da allowlist');
  const texts = [s.name, l.name, l.street, l.locality, ...s.activities, ...s.offers.map(o => o.name)].filter((t): t is string => typeof t === 'string');
  if (texts.some(t => PERSONAL.test(t))) fail('guarda de dados pessoais: e-mail ou telefone');
}

export function parseBetterSnapshot(json: unknown): BetterSnapshot {
  const s = json as Partial<BetterSnapshot>;
  if (!s || typeof s !== 'object') throw new Error('snapshot: JSON inválido');
  if (s.dry_run !== true || s.escrita_em_bd !== false) throw new Error('snapshot: só se aceita o relatório de preview (dry_run)');
  if (s.fonte?.source_key !== BETTER_CONFIG.source_key) throw new Error('snapshot: fonte diferente de Better OpenActive');
  if (s.fonte.feed_url !== BETTER_CONFIG.feed_url && !String(s.fonte.feed_url).startsWith('ficheiro local:')) throw new Error('snapshot: feed_url diferente do feed oficial');
  if (s.produto !== BETTER_CONFIG.product_key) throw new Error('snapshot: produto diferente do piloto UK');
  if (!s.gerado_em || Number.isNaN(Date.parse(s.gerado_em))) throw new Error('snapshot: gerado_em inválido');
  if (typeof s.fonte.feed_completo !== 'boolean') throw new Error('snapshot: feed_completo em falta');
  if (!Array.isArray(s.series)) throw new Error('snapshot: series em falta');
  for (const x of s.series) assertSeries(x);
  return s as BetterSnapshot;
}
