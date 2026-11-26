/**
 * Better OpenActive — sessões agendadas (scheduled-sessions RPDE) das séries
 * de Richmond. Puro: sem rede, sem BD, sem ficheiros.
 *
 * O feed é nacional e muito grande. O harvester (scripts/harvest-better-sessions.ts)
 * lê-o por partes e guarda só um estado compacto: cursor RPDE e, para as
 * séries de Richmond do snapshot, as sessões (id da série, início, fim,
 * eventStatus, capacidade). Nunca páginas inteiras, nunca texto livre.
 *
 * Na ingestão (--sessions), com reached_end = true, as ocorrências passam a
 * vir das sessões futuras confirmadas (não canceladas nem adiadas) em vez de
 * serem geradas a partir do eventSchedule.
 */
import type { RawActivityItem, RawOccurrence } from '../../types/RawActivityItem';
import { londonLocalToUtc, type BetterPlan } from './betterSeries';

export const SESSIONS_FEED_URL = 'https://better-admin.org.uk/api/openactive/better/scheduled-sessions';
export const SESSIONS_STATE_VERSION = 1;
export const NO_CONFIRMED_SESSIONS = 'sem sessões futuras confirmadas no feed';

export interface CompactSession {
  series_id: string;
  start: string;           // ISO 8601 da fonte
  end: string | null;
  status: string | null;   // ex.: 'https://schema.org/EventScheduled'
  remaining: number | null;
  maximum: number | null;
}

export interface HarvestRun {
  started_at: string;
  finished_at: string | null;
  pages: number;
  bytes: number;
  http_statuses: Record<string, number>;
  /** Itens com superEvent reconhecível (diagnóstico do formato) e itens guardados. */
  items_with_series_id?: number;
  sessions_kept?: number;
  stop_reason: string | null;
}

export interface SessionsState {
  version: number;
  feed_url: string;
  series_ids: string[];
  cursor: string;
  reached_end: boolean;
  pages_read_total: number;
  bytes_total: number;
  items_read_total: number;
  runs: HarvestRun[];
  sessions: Record<string, CompactSession>;
}

export function newState(seriesIds: readonly string[]): SessionsState {
  return {
    version: SESSIONS_STATE_VERSION, feed_url: SESSIONS_FEED_URL, series_ids: [...new Set(seriesIds)].sort(),
    cursor: SESSIONS_FEED_URL, reached_end: false, pages_read_total: 0, bytes_total: 0, items_read_total: 0, runs: [], sessions: {},
  };
}

const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

/** superEvent (URL, ou objecto com @id/id/url/identifier) → id da série. */
export function seriesIdFromSuperEvent(superEvent: unknown): string | null {
  const candidates: unknown[] = typeof superEvent === 'string' ? [superEvent]
    : superEvent && typeof superEvent === 'object'
      ? ['@id', 'id', 'url'].map(k => (superEvent as Record<string, unknown>)[k])
      : [];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const m = /activity_recurrence_group:([A-Za-z0-9_-]{1,80})\/?$/.exec(c);
    if (m) return m[1]!;
  }
  return null;
}

/**
 * Aplica uma página RPDE ao estado (in place). Só sessões de séries de
 * Richmond; "deleted" (ou uma actualização que mude de série) remove.
 */
export function applySessionsPage(state: SessionsState, items: readonly unknown[]): { kept: number; parsed: number } {
  const wanted = new Set(state.series_ids);
  let kept = 0, parsed = 0;
  for (const raw of items) {
    state.items_read_total++;
    const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = typeof it['id'] === 'string' || typeof it['id'] === 'number' ? String(it['id']) : null;
    if (!id || !ID.test(id)) continue;
    if (it['state'] === 'deleted') { delete state.sessions[id]; continue; }
    const d = (it['data'] && typeof it['data'] === 'object' ? it['data'] : {}) as Record<string, unknown>;
    const seriesId = seriesIdFromSuperEvent(d['superEvent']);
    const start = iso(d['startDate']);
    if (seriesId) parsed++;
    if (it['state'] !== 'updated' || !seriesId || !wanted.has(seriesId) || !start) { delete state.sessions[id]; continue; }
    const status = typeof d['eventStatus'] === 'string' && /^[A-Za-z0-9:/._-]{1,80}$/.test(d['eventStatus']) ? d['eventStatus'] : null;
    state.sessions[id] = {
      series_id: seriesId, start, end: iso(d['endDate']), status,
      remaining: num(d['remainingAttendeeCapacity']), maximum: num(d['maximumAttendeeCapacity']),
    };
    kept++;
  }
  return { kept, parsed };
}

/** Valida o ficheiro de estado (forma e allowlist). */
export function parseSessionsState(json: unknown): SessionsState {
  const s = json as Partial<SessionsState>;
  if (!s || typeof s !== 'object' || s.version !== SESSIONS_STATE_VERSION) throw new Error('sessions: estado inválido ou versão diferente');
  if (s.feed_url !== SESSIONS_FEED_URL) throw new Error('sessions: feed_url diferente do feed oficial');
  if (typeof s.cursor !== 'string' || !s.cursor.startsWith(SESSIONS_FEED_URL)) throw new Error('sessions: cursor fora do feed oficial');
  if (typeof s.reached_end !== 'boolean' || !Array.isArray(s.series_ids) || !s.series_ids.every(x => typeof x === 'string')) throw new Error('sessions: campos em falta');
  if (!s.sessions || typeof s.sessions !== 'object') throw new Error('sessions: sessions em falta');
  const allowed = new Set(['series_id', 'start', 'end', 'status', 'remaining', 'maximum']);
  for (const [id, x] of Object.entries(s.sessions)) {
    if (!ID.test(id) || !x || Object.keys(x).some(k => !allowed.has(k))) throw new Error(`sessions: sessão inválida (${id})`);
    if (!s.series_ids.includes(x.series_id) || !iso(x.start)) throw new Error(`sessions: sessão inválida (${id})`);
  }
  return s as SessionsState;
}

/** Instante → data/hora local de Londres. */
export function londonLocal(isoInstant: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(isoInstant));
  const g = (t: string) => parts.find(p => p.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

/** Cancelada ou adiada: não conta como sessão confirmada. */
export const isCancelled = (status: string | null) => status !== null && /(Cancelled|Postponed)$/i.test(status);

export interface ConfirmedSessions {
  occurrences: RawOccurrence[];
  cancelled_future: number;
  starts_utc: string[];
  capacity: Array<{ start_utc: string; remaining: number | null; maximum: number | null }>;
}

/** Sessões futuras confirmadas (data local >= hoje, não canceladas) por série. */
export function confirmedFutureBySeries(state: SessionsState, today: string): Map<string, ConfirmedSessions> {
  const out = new Map<string, ConfirmedSessions>();
  const sorted = Object.values(state.sessions).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const s of sorted) {
    const start = londonLocal(s.start);
    if (start.date < today) continue;
    const entry = out.get(s.series_id) ?? { occurrences: [], cancelled_future: 0, starts_utc: [], capacity: [] };
    out.set(s.series_id, entry);
    if (isCancelled(s.status)) { entry.cancelled_future++; continue; }
    const end = s.end ? londonLocal(s.end) : null;
    const key = `${start.date} ${start.time}`;
    if (entry.occurrences.some(o => `${o.date} ${o.time}` === key)) continue;
    entry.occurrences.push({ date: start.date, time: start.time, end_date: end && end.date !== start.date ? end.date : null, end_time: end?.time ?? null });
    const utc = londonLocalToUtc(start.date, start.time);
    entry.starts_utc.push(utc);
    entry.capacity.push({ start_utc: utc, remaining: s.remaining, maximum: s.maximum });
  }
  return out;
}

/**
 * Substitui as ocorrências geradas pelas sessões confirmadas. Série activa
 * sem sessões futuras confirmadas fica fora (held).
 */
export function applyConfirmedSessions(plan: BetterPlan, state: SessionsState, today: string): BetterPlan {
  const bySeries = confirmedFutureBySeries(state, today);
  const items: RawActivityItem[] = [];
  const held = [...plan.held];
  for (const item of plan.items) {
    const seriesId = item.source_item_id.replace(/^series:/, '');
    const c = bySeries.get(seriesId);
    if (!c || c.occurrences.length === 0) {
      held.push({ source_item_id: item.source_item_id, title: item.title, reason: NO_CONFIRMED_SESSIONS });
      continue;
    }
    items.push({
      ...item,
      occurrences: c.occurrences,
      raw_payload: {
        ...item.raw_payload,
        occurrences_source: 'scheduled_sessions_feed',
        occurrence_window_days: null,
        occurrence_starts_utc: c.starts_utc,
        confirmed_sessions: { count: c.occurrences.length, cancelled_future: c.cancelled_future, capacity: c.capacity, harvest_reached_end: state.reached_end },
      },
    });
  }
  const keep = new Set(items.map(i => i.source_item_id));
  return { ...plan, items, held, proposals: plan.proposals.filter(p => keep.has(p.source_item_id)) };
}
