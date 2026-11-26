/**
 * Better (GLL) OpenActive — parser PURO do RPDE session-series (piloto UK).
 *
 * Sem rede, sem BD. Recebe itens RPDE ({state, kind, id, modified, data})
 * e devolve RawActivityItem[] só para séries:
 *   - não apagadas (o último estado de cada id, pela ordem do feed);
 *   - com código postal numa área de Richmond (BETTER_CONFIG);
 *   - com pelo menos um eventSchedule sem endDate ou com endDate >= hoje.
 *
 * Privacidade (allowlist): só factos estruturados — identificador, URL,
 * rótulos de actividade, faixas etárias, ofertas (nome curto + preço),
 * horário estruturado, local (nome, morada, código postal) e licença.
 * NUNCA: description, leader/instructor, organizer, contactos, imagens.
 *
 * Ocorrências: geradas a partir do eventSchedule (byDay + startTime/endTime,
 * hora LOCAL de Europe/London) para os próximos 21 dias. A recorrência é a
 * DECLARADA pela fonte (repeatFrequency + byDay), não observada.
 */
import type { RawActivityItem, RawOccurrence } from '../../types/RawActivityItem';
import type { EligibilityRecord } from '../../review-api/eligibility/eligibilityAudit';
import { proposeEligibility, EXPLICIT_60PLUS } from '../../review-api/eligibility/proposal';
import { BETTER_CONFIG } from './config';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface RpdeItem {
  state?: unknown;
  kind?: unknown;
  id?: unknown;
  modified?: unknown;
  data?: unknown;
}

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface BetterSchedule {
  by_day: Weekday[];
  start_time: string | null;      // 'HH:MM' local (Europe/London)
  end_time: string | null;
  repeat_frequency: string | null; // ISO 8601, ex.: 'P1W'
  start_date: string | null;       // 'YYYY-MM-DD'
  end_date: string | null;
  except_dates: string[];
  timezone: string | null;         // scheduleTimezone declarado (null = não declarado)
}

export interface BetterOffer {
  name: string | null;
  price: number | null;
  currency: string | null;
  age_min: number | null;
  age_max: number | null;
}

/** Série já reduzida à allowlist: é isto que vai para o snapshot. */
export interface BetterSeries {
  identifier: string;
  rpde_modified: string | null;
  name: string;
  url: string | null;
  activities: string[];
  age_range: { min: number | null; max: number | null } | null;
  offers: BetterOffer[];
  location: { name: string; street: string | null; locality: string | null; postcode: string };
  schedules: BetterSchedule[];
}

export interface HeldItem { source_item_id: string; title: string; reason: string }

export interface BetterPlan {
  items: RawActivityItem[];
  proposals: EligibilityRecord[];
  held: HeldItem[];
  expired: Array<{ source_item_id: string; title: string; end_date: string | null }>;
}

// ── Utilitários ──────────────────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateOf = (v: unknown): string | null => { const s = str(v)?.slice(0, 10) ?? null; return s && DATE.test(s) ? s : null; };
const timeOf = (v: unknown): string | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(str(v) ?? '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
};

/** E-mail, ou sequência telefónica (nacional ou internacional) com 9+ dígitos. */
export const PERSONAL = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\(?\d[\d ().-]{7,}\d/;
/** "Yoga with Jane", "Pilates led by Sam": título que pode ter o nome do instrutor. */
export const TITLE_MAY_HAVE_PERSON = /\b(with|led by|taught by)\s+[A-Z][a-z]+\b/;
/** Código postal britânico completo. */
export const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/;
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,80}$/;
/** Página pública da Better (sem query nem fragmento). */
const BETTER_URL = /^https:\/\/(www\.)?better\.org\.uk\/[A-Za-z0-9\-/_.]{0,200}$/;
const SHORT_LABEL = /^[A-Za-z0-9 &+/()',.-]{1,60}$/;

export function normalizePostcode(v: unknown): string | null {
  const raw = str(v)?.toUpperCase().replace(/\s+/g, '') ?? null;
  if (!raw || !/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(raw)) return null;
  return `${raw.slice(0, -3)} ${raw.slice(-3)}`;
}

export function isRichmondPostcode(postcode: string | null): boolean {
  if (!postcode) return false;
  const outward = postcode.split(' ')[0]!;
  return BETTER_CONFIG.richmond_postcode_areas.includes(outward);
}

export function parseWeekday(v: unknown): Weekday | null {
  const s = str(v);
  if (!s) return null;
  const tail = s.replace(/^.*[/:#]/, '').toLowerCase();
  const ical: Record<string, Weekday> = { su: 'sunday', mo: 'monday', tu: 'tuesday', we: 'wednesday', th: 'thursday', fr: 'friday', sa: 'saturday' };
  return (WEEKDAYS as readonly string[]).includes(tail) ? tail as Weekday : ical[tail] ?? null;
}

// ── Extracção (allowlist) ────────────────────────────────────────────────────

function extractSchedule(raw: unknown): BetterSchedule | null {
  const s = obj(raw);
  if (!s) return null;
  const by_day = [...new Set(arr(s['byDay']).map(parseWeekday).filter((d): d is Weekday => d !== null))];
  const freq = str(s['repeatFrequency']);
  return {
    by_day: WEEKDAYS.filter(d => by_day.includes(d)),
    start_time: timeOf(s['startTime']),
    end_time: timeOf(s['endTime']),
    repeat_frequency: freq && /^P\d+[DWMY]$/.test(freq) ? freq : null,
    start_date: dateOf(s['startDate']),
    end_date: dateOf(s['endDate']),
    except_dates: arr(s['exceptDate']).map(dateOf).filter((d): d is string => d !== null).sort(),
    timezone: str(s['scheduleTimezone']),
  };
}

function shortLabel(v: unknown): string | null {
  const s = str(v);
  return s && SHORT_LABEL.test(s) && !PERSONAL.test(s) ? s : null;
}

function extractOffer(raw: unknown): BetterOffer | null {
  const o = obj(raw);
  if (!o) return null;
  const age = obj(o['ageRestriction']);
  const cur = str(o['priceCurrency']);
  return {
    name: shortLabel(o['name']),
    price: num(o['price']),
    currency: cur && /^[A-Z]{3}$/.test(cur) ? cur : null,
    age_min: num(age?.['minValue']),
    age_max: num(age?.['maxValue']),
  };
}

/** Item RPDE → série reduzida à allowlist; null se apagado, sem dados ou sem código postal válido. */
export function extractSeries(item: RpdeItem): BetterSeries | null {
  if (item.state !== 'updated') return null;
  const d = obj(item.data);
  if (!d) return null;
  const identifier = str(d['identifier']) ?? str(item.id);
  const name = str(d['name']);
  const loc = obj(d['location']);
  const addr = obj(loc?.['address']);
  const postcode = normalizePostcode(addr?.['postalCode']);
  const locName = str(loc?.['name']);
  if (!identifier || !IDENTIFIER.test(identifier) || !name || !postcode || !locName) return null;
  const url = str(d['url']);
  const ageRange = obj(d['ageRange']);
  const activities = [...new Set(arr(d['activity']).map(a => shortLabel(obj(a)?.['prefLabel'] ?? a)).filter((a): a is string => a !== null))];
  const street = str(addr?.['streetAddress']);
  const locality = str(addr?.['addressLocality']);
  return {
    identifier,
    rpde_modified: str(item.modified),
    name: name.slice(0, 120),
    url: url && BETTER_URL.test(url) ? url : null,
    activities,
    age_range: ageRange ? { min: num(ageRange['minValue']), max: num(ageRange['maxValue']) } : null,
    offers: arr(d['offers']).map(extractOffer).filter((o): o is BetterOffer => o !== null),
    location: {
      name: locName.slice(0, 120),
      street: street && !PERSONAL.test(street) ? street.slice(0, 160) : null,
      locality: locality && !PERSONAL.test(locality) ? locality.slice(0, 80) : null,
      postcode,
    },
    schedules: arr(d['eventSchedule']).map(extractSchedule).filter((s): s is BetterSchedule => s !== null),
  };
}

/**
 * Acumulador RPDE: processa as páginas pela ordem do feed e guarda SÓ as
 * séries de Richmond (o feed nacional nunca é retido). Um "deleted" posterior
 * remove a série; uma actualização posterior substitui-a.
 */
export class RichmondAccumulator {
  private readonly byId = new Map<string, BetterSeries>();
  items_read = 0;
  deleted_read = 0;

  add(items: readonly RpdeItem[]): void {
    for (const it of items) {
      this.items_read++;
      const id = str(it.id);
      if (it.state === 'deleted') {
        this.deleted_read++;
        if (id) this.byId.delete(id);
        continue;
      }
      const s = extractSeries(it);
      if (!id) continue;
      if (s && isRichmondPostcode(s.location.postcode)) this.byId.set(id, s);
      else this.byId.delete(id); // mudou de local / deixou de ser válida
    }
  }

  series(): BetterSeries[] {
    return [...this.byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.identifier.localeCompare(b.identifier));
  }
}

export function selectRichmondSeries(items: readonly RpdeItem[]): BetterSeries[] {
  const acc = new RichmondAccumulator();
  acc.add(items);
  return acc.series();
}

// ── Datas, fuso e ocorrências ────────────────────────────────────────────────

export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const weekdayOf = (date: string): Weekday => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/** Desvio (minutos) de Europe/London no instante dado: 0 (GMT) ou 60 (BST). */
function londonOffsetMinutes(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(instant));
  const g = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const local = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return Math.round((local - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

/** Hora local de Londres → instante UTC (ISO). 09:30 BST = 08:30Z; 09:30 GMT = 09:30Z. */
export function londonLocalToUtc(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let utc = guess - londonOffsetMinutes(guess) * 60_000;
  const off2 = londonOffsetMinutes(utc);
  utc = guess - off2 * 60_000;
  return new Date(utc).toISOString().replace('.000Z', 'Z');
}

/** Data de hoje em Europe/London. */
export function londonToday(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function scheduleIsActive(s: BetterSchedule, today: string): boolean {
  return s.end_date === null || s.end_date >= today;
}

export function seriesIsActive(series: BetterSeries, today: string): boolean {
  return series.schedules.some(s => scheduleIsActive(s, today));
}

/** Fuso aceite: Europe/London declarado, ou ausente (assumido e assinalado). */
const scheduleTzOk = (s: BetterSchedule) => s.timezone === null || s.timezone === BETTER_CONFIG.timezone;
/** Semanal: P1W ou P7D (a Better usa P7D). Diário: P1D. Outras frequências: sem ocorrências (nada inventado). */
export const WEEKLY_FREQ: ReadonlySet<string> = new Set(['P1W', 'P7D']);
const SUPPORTED_FREQ = new Set([...WEEKLY_FREQ, 'P1D']);

export interface GeneratedOccurrences {
  occurrences: RawOccurrence[];
  unsupported: string[]; // motivos (ex.: frequência não suportada)
}

export function generateOccurrences(schedules: readonly BetterSchedule[], today: string, windowDays = BETTER_CONFIG.occurrence_window_days): GeneratedOccurrences {
  const out = new Map<string, RawOccurrence>();
  const unsupported = new Set<string>();
  for (const s of schedules) {
    if (!scheduleIsActive(s, today)) continue;
    if (!scheduleTzOk(s)) { unsupported.add(`fuso não suportado (${s.timezone})`); continue; }
    if (!s.repeat_frequency || !SUPPORTED_FREQ.has(s.repeat_frequency)) { unsupported.add(`repeatFrequency não suportada (${s.repeat_frequency ?? 'ausente'})`); continue; }
    if (WEEKLY_FREQ.has(s.repeat_frequency) && s.by_day.length === 0) { unsupported.add('frequência semanal sem byDay'); continue; }
    for (let i = 0; i < windowDays; i++) {
      const date = addDays(today, i);
      if (s.start_date && date < s.start_date) continue;
      if (s.end_date && date > s.end_date) continue;
      if (s.except_dates.includes(date)) continue;
      if (WEEKLY_FREQ.has(s.repeat_frequency) && !s.by_day.includes(weekdayOf(date))) continue;
      const occ: RawOccurrence = { date, time: s.start_time, end_date: null, end_time: s.end_time };
      out.set(`${date} ${s.start_time ?? ''}`, occ);
    }
  }
  const occurrences = [...out.values()].sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
  return { occurrences, unsupported: [...unsupported] };
}

// ── Preço e elegibilidade ────────────────────────────────────────────────────

function money(price: number, currency: string | null): string {
  const v = price.toFixed(2);
  return currency === 'GBP' || currency === null ? `£${v}` : `${currency} ${v}`;
}

/** Ex.: "Adult £8.80; Concession £6.20". null se a fonte não indicar preço. */
export function priceText(offers: readonly BetterOffer[]): string | null {
  const parts = [...new Set(offers.filter(o => o.price !== null).map(o => `${o.name ? `${o.name} ` : ''}${money(o.price!, o.currency)}`))];
  return parts.length ? parts.join('; ') : null;
}

const WEEKDAY_EN: Record<Weekday, string> = {
  sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
};

/**
 * Texto de recorrência GERADO a partir dos campos estruturados (não é texto
 * livre da fonte); o detector EN (02-recurrence-detection) lê-o.
 */
export function recurrenceHint(schedules: readonly BetterSchedule[], today: string): string | null {
  // Agrupa por horário (vários eventSchedule com a mesma hora em dias diferentes).
  const byTime = new Map<string, Set<Weekday>>();
  for (const s of schedules) {
    if (!scheduleIsActive(s, today) || !s.repeat_frequency || !WEEKLY_FREQ.has(s.repeat_frequency) || s.by_day.length === 0) continue;
    const t = s.start_time ? `${s.start_time}${s.end_time ? `-${s.end_time}` : ''}` : '';
    byTime.set(t, new Set([...(byTime.get(t) ?? []), ...s.by_day]));
  }
  const parts = [...byTime].sort(([a], [b]) => a.localeCompare(b))
    .map(([t, days]) => `Weekly on ${WEEKDAYS.filter(d => days.has(d)).map(d => WEEKDAY_EN[d]).join(', ')}${t ? ` ${t}` : ''}`);
  return parts.length ? parts.join('; ') : null;
}

/** Ofertas com crianças (ex.: "Child", "Adult and 1 under 4"): sessão para todas as idades/família. */
const CHILD_OFFER = /\b(child|children|junior|under \d+|under-\d+|infant|toddler)\b/i;

export const GENERAL_ADULT_EVIDENCE = 'sessão geral para adultos (16+), sem referência a 60+';

export function proposeBetterEligibility(series: BetterSeries, sourceItemId: string, schedule_complete: boolean): EligibilityRecord {
  const minAges = [series.age_range?.min ?? null, ...series.offers.map(o => o.age_min)].filter((a): a is number => a !== null);
  const ageMin60 = minAges.find(a => a >= 60);
  const nameExplicit = EXPLICIT_60PLUS.test(series.name);
  const maxAge = series.age_range?.max ?? null;
  const price = priceText(series.offers);
  const base = proposeEligibility({
    source_item_id: sourceItemId,
    source_url: series.url,
    title: series.name,
    kind: 'group',
    categories: series.activities,
    organisation_evidence: BETTER_CONFIG.organisation_evidence,
    membership_required: null,
    explicit_older: ageMin60 !== undefined ? `${ageMin60}+ (idade mínima declarada)` : nameExplicit ? series.name : null,
    audience_snippets: [],
    booking: null,
    spaces_limited: false,
    price_text: price,
    physical_hint: true,
    has_location: true,
    generic_venue: false,
    schedule_complete,
  });

  if (base.classification === 'confirmed_60plus') {
    base.confidence = 'medium'; // automático: nunca "high" sem revisão humana
    base.evidence = ageMin60 !== undefined
      ? `A fonte declara idade mínima ${ageMin60} (${series.age_range?.min === ageMin60 ? 'ageRange.minValue' : 'offers[].ageRestriction.minValue'}).`
      : `O nome da sessão refere explicitamente 60+ ("${series.name}").`;
    base.human_review_notes.push('Confirmação automática a partir de campos estruturados OpenActive: validar com revisão humana.');
    return base;
  }
  if (maxAge !== null && maxAge < 60) {
    return {
      ...base, classification: 'unsuitable', confidence: 'medium', eligibility_type: 'not_applicable',
      evidence: `A faixa etária declarada pela fonte (${series.age_range?.min ?? '?'}–${maxAge}) exclui 60+.`,
      recommendation: 'Fora de publicação.',
    };
  }
  if (base.classification === 'unsuitable') return base;
  // Sessão geral de ginásio/piscina: nunca likely_suitable automático.
  // Idade mínima: ageRange da série ou, na falta dela, a menor das ofertas.
  const offerMins = series.offers.map(o => o.age_min).filter((a): a is number => a !== null);
  const min = series.age_range?.min ?? (offerMins.length ? Math.min(...offerMins) : null);
  const notes = [...base.human_review_notes];
  if (series.offers.some(o => o.name && CHILD_OFFER.test(o.name))) {
    notes.push('As ofertas incluem crianças (ex.: "Child"): sessão para todas as idades/família, não dirigida a 60+.');
  }
  return {
    ...base,
    classification: 'unclear',
    confidence: 'medium',
    eligibility_type: 'unknown',
    evidence: min === null
      ? 'sessão geral (sem faixa etária declarada na fonte), sem referência a 60+'
      : min === 16 ? GENERAL_ADULT_EVIDENCE : `sessão geral (${min}+), sem referência a 60+`,
    recommendation: 'Manter em pending_review; decisão de âmbito ou dados em falta.',
    human_review_notes: notes,
  };
}

// ── Plano ────────────────────────────────────────────────────────────────────

export const sourceItemIdOf = (s: BetterSeries) => `series:${s.identifier}`;

function assertNoPersonalData(item: RawActivityItem, extra: readonly string[]): void {
  const texts = [item.title, item.raw_category_text, item.price_text, item.venue_mention?.raw_text, item.venue_mention?.raw_address_text, ...extra]
    .filter((t): t is string => typeof t === 'string');
  if (texts.some(t => PERSONAL.test(t))) throw new Error(`guarda de dados pessoais: e-mail ou telefone em ${item.source_item_id}`);
}

export function planFromSeries(series: readonly BetterSeries[], today: string, collectedAt: string, snapshotMeta: Record<string, unknown> = {}): BetterPlan {
  const items: RawActivityItem[] = [];
  const proposals: EligibilityRecord[] = [];
  const held: HeldItem[] = [];
  const expired: BetterPlan['expired'] = [];

  for (const s of series) {
    const id = sourceItemIdOf(s);
    if (!seriesIsActive(s, today)) {
      const ends = s.schedules.map(x => x.end_date).filter((d): d is string => d !== null).sort();
      expired.push({ source_item_id: id, title: s.name, end_date: ends.at(-1) ?? null });
      continue;
    }
    if (TITLE_MAY_HAVE_PERSON.test(s.name)) {
      held.push({ source_item_id: id, title: '(título omitido: pode ter nome de pessoa)', reason: 'título pode conter nome de pessoa — revisão manual' });
      continue;
    }
    const { occurrences, unsupported } = generateOccurrences(s.schedules, today);
    if (occurrences.length === 0) {
      held.push({ source_item_id: id, title: s.name, reason: unsupported.length ? `sem ocorrências geráveis: ${unsupported.join('; ')}` : `sem ocorrências nos próximos ${BETTER_CONFIG.occurrence_window_days} dias` });
      continue;
    }
    const proposal = proposeBetterEligibility(s, id, occurrences.every(o => o.time !== null));
    if (proposal.classification === 'unsuitable') {
      held.push({ source_item_id: id, title: s.name, reason: `fora do público: ${proposal.evidence}` });
      continue;
    }
    const active = s.schedules.filter(x => scheduleIsActive(x, today));
    if (active.some(x => x.timezone === null)) proposal.human_review_notes.push('scheduleTimezone ausente na fonte: horas assumidas como Europe/London.');
    const price = priceText(s.offers);
    const address = [s.location.street, s.location.locality, s.location.postcode].filter(Boolean).join(', ');
    const item: RawActivityItem = {
      source_key: BETTER_CONFIG.source_key,
      source_item_id: id,
      collected_at: collectedAt,
      title: s.name,
      description: null,
      raw_category_text: s.activities.join(', ') || null,
      occurrences,
      recurrence_text_hint: recurrenceHint(active, today),
      venue_mention: { raw_text: s.location.name, raw_address_text: address || null, confidence_hint: 'explicit_name' },
      price_text: price,
      is_free_hint: s.offers.length > 0 && s.offers.every(o => o.price === 0) ? true : null,
      image_url: null,
      external_url: s.url,
      contact_phone: null,
      contact_email: null,
      language: 'en',
      raw_payload: {
        source: {
          feed_url: BETTER_CONFIG.feed_url,
          licence: BETTER_CONFIG.licence.name,
          licence_url: BETTER_CONFIG.licence.url,
          attribution: BETTER_CONFIG.licence.attribution,
          rpde_modified: s.rpde_modified,
          ...snapshotMeta,
        },
        identifier: s.identifier,
        url: s.url,
        activity_labels: s.activities,
        age_range: s.age_range,
        offer_age_restrictions: s.offers.filter(o => o.age_min !== null || o.age_max !== null).map(o => ({ offer: o.name, min: o.age_min, max: o.age_max })),
        schedule: active,
        recurrence: { declared_by_source: true, repeat_frequency: [...new Set(active.map(x => x.repeat_frequency))], by_day: [...new Set(active.flatMap(x => x.by_day))] },
        occurrence_window_days: BETTER_CONFIG.occurrence_window_days,
        occurrence_starts_utc: occurrences.filter(o => o.time).map(o => londonLocalToUtc(o.date, o.time!)),
        postcode: s.location.postcode,
        timezone: BETTER_CONFIG.timezone,
        eligibility_proposal: proposal,
      },
    };
    assertNoPersonalData(item, [...s.activities, proposal.evidence, ...proposal.human_review_notes]);
    items.push(item);
    proposals.push(proposal);
  }
  items.sort((a, b) => a.title.localeCompare(b.title) || a.source_item_id.localeCompare(b.source_item_id));
  proposals.sort((a, b) => a.title.localeCompare(b.title) || a.source_item_id.localeCompare(b.source_item_id));
  return { items, proposals, held, expired };
}

/** Parser puro: itens RPDE → RawActivityItem[] (Richmond, não apagados, activos). */
export function fromSessionSeries(items: readonly RpdeItem[], today: string, collectedAt = new Date().toISOString()): RawActivityItem[] {
  return planFromSeries(selectRichmondSeries(items), today, collectedAt).items;
}

/** Idempotência: séries já em staging (mesma fonte, id e produto) não voltam a entrar. */
export function splitByExisting(items: RawActivityItem[], existing: ReadonlySet<string>): { insert: RawActivityItem[]; skip: string[] } {
  return {
    insert: items.filter(i => !existing.has(i.source_item_id)),
    skip: items.filter(i => existing.has(i.source_item_id)).map(i => i.source_item_id),
  };
}
