/**
 * Curadoria manual de actividades 60+ (piloto UK, só staging).
 *
 * Fontes pequenas sem feed: os factos (título, dia, hora, local, custo, link)
 * são lidos à mão em páginas oficiais, DEPOIS de ler robots.txt e termos, e
 * versionados em richmond-curated-60plus.v1.json. Este módulo não faz pedidos
 * HTTP: valida o ficheiro, gera ocorrências e propõe elegibilidade com as
 * mesmas regras da Issue #62 (proposeEligibility).
 *
 * Regra de inclusão (aplicada na curadoria e reverificada aqui):
 *   evidência 60+ explícita, OU organizada pela própria entidade dedicada a
 *   pessoas mais velhas, OU público com condição de saúde (proposta unclear);
 *   e sempre dia, hora e local verificáveis.
 */
import type { RawActivityItem, RawOccurrence } from '../../types/RawActivityItem';
import type { EligibilityRecord } from '../../review-api/eligibility/eligibilityAudit';
import { proposeEligibility, RESTRICTED_AUDIENCE } from '../../review-api/eligibility/proposal';
import { restrictedAudience } from '../fish-ics/fishSnapshot';
import { audienceRestrictionLabel } from '../../review-api/eligibility/audienceRestriction';
import { UK_PILOT_PRODUCT } from '../u3a-siteworks/config';

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type Dow = (typeof DOW)[number];

export interface CuratedItem {
  source: string;
  id: string;
  title: string;
  schedule: { type: 'weekly' | 'monthly_nth'; days: Dow[]; nth?: number; start: string; end: string | null };
  venue: { name: string; address: string | null; postcode: string };
  cost_text: string | null;
  booking: 'registration_required' | 'contact_provider' | 'drop_in' | 'booking_essential';
  audience_snippets: string[];
  explicit_60plus_quote: string | null;
  organised_by_org: boolean;
  url: string;
}

export interface CuratedOrganisation { name: string; site: string; organisation_evidence: string; terms_note: string }

export interface CuratedDataset {
  schema_version: 1;
  product: string;
  verified_at: string;
  organisations: Record<string, CuratedOrganisation>;
  items: CuratedItem[];
  excluded: Array<{ source: string; title: string; reason: string }>;
}

const SOURCE_KEY = /^[a-z][a-z0-9_]{2,40}$/;
const ITEM_ID = /^series:[a-z0-9-]{1,80}:(mon|tue|wed|thu|fri|sat|sun)(-[1-5])?:\d{4}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/;
const BOOKING = ['registration_required', 'contact_provider', 'drop_in', 'booking_essential'];
const PERSONAL = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\(?\d[\d ().-]{7,}\d/;

/** Validação estrita (runtime): qualquer desvio recusa o ficheiro inteiro. */
export function parseCuratedDataset(json: unknown): CuratedDataset {
  const d = json as Partial<CuratedDataset>;
  if (!d || d.schema_version !== 1) throw new Error('curadoria: schema_version inválida');
  if (d.product !== UK_PILOT_PRODUCT) throw new Error('curadoria: produto diferente do piloto UK');
  if (!d.verified_at || !/^\d{4}-\d{2}-\d{2}$/.test(d.verified_at)) throw new Error('curadoria: verified_at inválido');
  if (!d.organisations || !Array.isArray(d.items)) throw new Error('curadoria: organisations/items em falta');
  for (const [k, o] of Object.entries(d.organisations)) {
    if (!SOURCE_KEY.test(k)) throw new Error(`curadoria: source_key inválida (${k})`);
    if (!o.site?.startsWith('https://') || !o.organisation_evidence) throw new Error(`curadoria: organização incompleta (${k})`);
  }
  const ids = new Set<string>();
  for (const it of d.items) {
    const w = `curadoria: ${it.id}`;
    const org = d.organisations[it.source];
    if (!org) throw new Error(`${w}: organização desconhecida`);
    if (!ITEM_ID.test(it.id) || ids.has(`${it.source}|${it.id}`)) throw new Error(`${w}: id inválido ou repetido`);
    ids.add(`${it.source}|${it.id}`);
    if (!it.title?.trim()) throw new Error(`${w}: título vazio`);
    const s = it.schedule;
    if (!s || !['weekly', 'monthly_nth'].includes(s.type) || !Array.isArray(s.days) || s.days.length === 0
      || !s.days.every(x => (DOW as readonly string[]).includes(x))) throw new Error(`${w}: horário inválido`);
    if (s.type === 'monthly_nth' && !(Number.isInteger(s.nth) && s.nth! >= 1 && s.nth! <= 5)) throw new Error(`${w}: nth inválido`);
    if (!HHMM.test(s.start) || (s.end !== null && !HHMM.test(s.end))) throw new Error(`${w}: hora inválida`);
    if (!it.venue?.name || !UK_POSTCODE.test(it.venue.postcode ?? '')) throw new Error(`${w}: local sem código postal válido`);
    if (!BOOKING.includes(it.booking)) throw new Error(`${w}: inscrição inválida`);
    if (!it.url.startsWith(org.site)) throw new Error(`${w}: URL fora do site oficial da organização`);
    if (/[?#]|%/.test(it.url)) throw new Error(`${w}: URL com query, fragmento ou codificação`);
    // Regra de inclusão
    const condition = RESTRICTED_AUDIENCE.test(it.audience_snippets.join(' '));
    if (!it.explicit_60plus_quote && !it.organised_by_org && !condition) throw new Error(`${w}: sem sinal 60+ (regra de inclusão)`);
    const texts = [it.title, it.cost_text, it.venue.name, it.venue.address, ...it.audience_snippets, it.explicit_60plus_quote]
      .filter((t): t is string => typeof t === 'string');
    if (texts.some(t => PERSONAL.test(t))) throw new Error(`${w}: guarda de dados pessoais (e-mail/telefone)`);
  }
  return d as CuratedDataset;
}

/** Data local (YYYY-MM-DD) + n dias, sem fuso (aritmética em UTC sobre a data civil). */
function addDays(ymd: string, n: number): string {
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
function dowOf(ymd: string): Dow {
  return DOW[new Date(`${ymd}T00:00:00Z`).getUTCDay()]!;
}

/** Ocorrências declaradas (hora local de Londres) entre today e today + windowDays. */
export function occurrencesFor(s: CuratedItem['schedule'], today: string, windowDays = 28): RawOccurrence[] {
  const out: RawOccurrence[] = [];
  for (let i = 0; i <= windowDays; i++) {
    const d = addDays(today, i);
    const dow = dowOf(d);
    if (!s.days.includes(dow)) continue;
    if (s.type === 'monthly_nth' && Math.ceil(+d.slice(8, 10) / 7) !== s.nth) continue;
    out.push({ date: d, time: s.start, end_date: null, end_time: s.end });
  }
  return out;
}

const DAY_EN: Record<Dow, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const NTH_EN = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth'];

/** Recorrência DECLARADA pela fonte, em texto (lido pelo 02-recurrence-detection). */
export function recurrenceHint(s: CuratedItem['schedule']): string {
  const days = s.days.map(d => DAY_EN[d]).join(' and ');
  return s.type === 'weekly' ? `Every ${days}` : `${NTH_EN[s.nth!]} ${days} of each month`;
}

export interface CuratedPlan {
  bySource: Map<string, RawActivityItem[]>;
  proposals: EligibilityRecord[];
  held: Array<{ source: string; id: string; title: string; reason: string }>;
}

export function planFromCurated(ds: CuratedDataset, today: string, windowDays = 28): CuratedPlan {
  const bySource = new Map<string, RawActivityItem[]>();
  const proposals: EligibilityRecord[] = [];
  const held: CuratedPlan['held'] = [];
  for (const it of ds.items) {
    const org = ds.organisations[it.source]!;
    // Monthly: janela maior para mostrar pelo menos uma ocorrência.
    const occurrences = occurrencesFor(it.schedule, today, it.schedule.type === 'monthly_nth' ? Math.max(windowDays, 62) : windowDays);
    if (occurrences.length === 0) { held.push({ source: it.source, id: it.id, title: it.title, reason: 'sem ocorrências na janela' }); continue; }
    const restricted = restrictedAudience(it.audience_snippets);
    const proposal = proposeEligibility({
      source_item_id: it.id,
      source_url: it.url,
      title: it.title,
      kind: 'group',
      categories: [],
      organisation_evidence: org.organisation_evidence,
      membership_required: it.booking === 'registration_required' ? true : null,
      explicit_older: it.explicit_60plus_quote,
      audience_snippets: it.audience_snippets,
      booking: it.booking === 'drop_in' ? 'drop_in' : it.booking === 'booking_essential' ? 'booking_essential' : null,
      spaces_limited: false,
      price_text: it.cost_text,
      physical_hint: /exercise|yoga|dance|fitness/i.test(it.title),
      has_location: true,
      generic_venue: false,
      schedule_complete: true,
    });
    if (!it.organised_by_org && !it.explicit_60plus_quote) {
      proposal.human_review_notes.push('Actividade de outra entidade realizada no local da organização; sem referência de idade própria.');
    }
    if (restricted) {
      proposal.access_notes = audienceRestrictionLabel(restricted.condition, restricted.target);
    }
    proposal.human_review_notes.push(`Curadoria manual (${ds.verified_at}): confirmar na página oficial antes de aprovar.`);
    const item: RawActivityItem = {
      source_key: it.source,
      source_item_id: it.id,
      collected_at: `${ds.verified_at}T12:00:00.000Z`,
      title: it.title,
      description: null,
      raw_category_text: null,
      occurrences,
      recurrence_text_hint: recurrenceHint(it.schedule),
      venue_mention: { raw_text: it.venue.name, raw_address_text: [it.venue.address, it.venue.postcode].filter(Boolean).join(', '), confidence_hint: 'explicit_name' },
      price_text: it.cost_text,
      is_free_hint: null,
      image_url: null,
      external_url: it.url,
      contact_phone: null,
      contact_email: null,
      language: 'en',
      raw_payload: {
        curated: { verified_at: ds.verified_at, method: 'manual_official_page', organisation: org.name, terms_note: org.terms_note },
        schedule_declared: it.schedule,
        timezone: 'Europe/London',
        postcode: it.venue.postcode,
        booking: it.booking,
        restricted_audience: restricted,
        explicit_older_level: it.explicit_60plus_quote ? 'declared' : null,
        organised_by_org: it.organised_by_org,
        eligibility_proposal: proposal,
      },
    };
    bySource.set(it.source, [...(bySource.get(it.source) ?? []), item]);
    proposals.push(proposal);
  }
  return { bySource, proposals, held };
}
