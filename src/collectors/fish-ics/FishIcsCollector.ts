/**
 * Colector FiSH Neighbourhood Care (ICS público) → RawActivityItem.
 *
 * - Um GET ao ICS por execução (robots.txt: sem REST, Crawl-delay 10).
 * - O ICS traz uma VEVENT por ocorrência (sem RRULE). As ocorrências são
 *   agrupadas em SÉRIES com chave estável `series:<título>:<dia>:<hora>`,
 *   que é o source_item_id (mesma regra de chave estável da Issue #62).
 * - Privacidade: description, contact_* = null. Da DESCRIPTION só saem os
 *   sinais da allowlist de fishText.ts; raw_payload é um subconjunto construído.
 * - Exclusões com motivo: sem data, passado, cancelado, só online, casa privada.
 * - Não interpreta recorrência (fica para o pipeline); o preview mostra só a
 *   recorrência OBSERVADA nas datas, rotulada como tal.
 */
import type { RawActivityItem, RawOccurrence, VenueMention } from '../../types/RawActivityItem';
import { parseIcs, type IcsEvent } from '../ics/icsParser';
import { isCancelledTitle, isOnlineVenue, isPrivateVenue, extractUkPostcode } from '../u3a-siteworks/sanitize';
import { extractSignals, slugify, splitLocation, titleMayContainPersonName, PHYSICAL, type FishTextSignals } from './fishText';
import { FISH_CONFIG } from './config';

export type FetchText = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; text: string }>;

export interface CollectError { message: string; source_item_id: string | null }

export interface FishSeries {
  item: RawActivityItem;
  signals: FishTextSignals;
  physical_hint: boolean;
  occurrence_urls: string[];
  locations_differ: boolean;
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function dayOfWeek(date: string): typeof DOW[number] {
  const [y, m, d] = date.split('-').map(Number);
  return DOW[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

export function seriesKey(title: string, date: string, time: string | null): string {
  return `series:${slugify(title)}:${dayOfWeek(date)}:${time ? time.replace(':', '') : 'allday'}`;
}

export class FishIcsCollector {
  readonly sourceKey = FISH_CONFIG.source_key;

  constructor(
    private readonly fetchText: FetchText,
    private readonly today: string,                 // YYYY-MM-DD (Europe/London)
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Um único pedido ao ICS. Erro HTTP → excepção (o preview regista e pára). */
  async fetchIcs(): Promise<string> {
    const res = await this.fetchText(FISH_CONFIG.ics_url, {
      headers: { 'User-Agent': FISH_CONFIG.user_agent, Accept: 'text/calendar' },
    });
    if (res.status !== 200) throw new Error(`ICS FiSH: HTTP ${res.status}`);
    if (!/BEGIN:VCALENDAR/.test(res.text)) throw new Error('ICS FiSH: resposta não é iCalendar');
    return res.text;
  }

  async collect(): Promise<{ items: RawActivityItem[]; errors: CollectError[]; series: FishSeries[]; events_read: number }> {
    return this.fromIcs(await this.fetchIcs());
  }

  /** Separado do fetch para testes com fixtures e para --ics-file. */
  fromIcs(ics: string): { items: RawActivityItem[]; errors: CollectError[]; series: FishSeries[]; events_read: number } {
    const events = parseIcs(ics);
    const errors: CollectError[] = [];
    const groups = new Map<string, IcsEvent[]>();

    for (const e of events) {
      const ref = e.uid;
      const title = (e.summary ?? '').trim();
      if (!title) { errors.push({ message: 'skip:no_title', source_item_id: ref }); continue; }
      if (!e.start) { errors.push({ message: 'skip:event_without_date', source_item_id: ref }); continue; }
      if (e.start.date < this.today) { errors.push({ message: 'skip:past_event', source_item_id: ref }); continue; }
      if (e.status === 'CANCELLED' || isCancelledTitle(title)) { errors.push({ message: 'skip:cancelled', source_item_id: ref }); continue; }
      if (isPrivateVenue(e.location)) { errors.push({ message: 'skip:private_venue', source_item_id: ref }); continue; }
      if (isOnlineVenue(e.location)) { errors.push({ message: 'skip:online_only', source_item_id: ref }); continue; }
      const key = seriesKey(title, e.start.date, e.start.time);
      const list = groups.get(key);
      if (list) list.push(e); else groups.set(key, [e]);
    }

    const collectedAt = this.now();
    const series: FishSeries[] = [...groups.entries()].map(([key, evs]) => {
      evs.sort((a, b) => (a.start!.date + (a.start!.time ?? '')).localeCompare(b.start!.date + (b.start!.time ?? '')));
      const first = evs[0]!;
      const occurrences: RawOccurrence[] = evs.map(e => {
        const sameDay = !e.end || e.end.date === e.start!.date;
        // DTEND igual a DTSTART = a fonte não indica o fim (não é "duração zero").
        const endTime = e.end?.time && !(sameDay && e.end.time === e.start!.time) ? e.end.time : null;
        return { date: e.start!.date, time: e.start!.time, end_date: sameDay ? null : e.end!.date, end_time: endTime };
      });
      // Sinais: primeira descrição não vazia (as ocorrências de uma série repetem o texto).
      const signals = extractSignals(evs.find(e => e.description)?.description ?? null);
      const categories = [...new Set(evs.flatMap(e => e.categories))];
      const locations = [...new Set(evs.map(e => e.location).filter((l): l is string => !!l))];
      const loc = splitLocation(locations[0] ?? null);
      const venue: VenueMention | null = loc
        ? { raw_text: loc.name, raw_address_text: loc.address, confidence_hint: locations.length > 1 ? 'ambiguous' : 'explicit_name' }
        : null;
      const urls = [...new Set(evs.map(e => e.url).filter((u): u is string => !!u))];
      const item: RawActivityItem = {
        source_key: FISH_CONFIG.source_key,
        source_item_id: key,
        collected_at: collectedAt,
        title: first.summary!.trim(),
        description: null, // texto livre com contactos pessoais — não é copiado
        raw_category_text: categories.join(', ') || null,
        occurrences,
        recurrence_text_hint: null,
        venue_mention: venue,
        price_text: signals.price_text,
        is_free_hint: signals.is_free_hint,
        image_url: null,
        external_url: urls[0] ?? null,
        contact_phone: null,
        contact_email: null,
        language: 'en',
        raw_payload: {
          ics_uids: evs.map(e => e.uid).filter(Boolean),
          occurrence_urls: urls,
          categories,
          location_text: locations[0] ?? null,
          postcode: extractUkPostcode(locations[0] ?? null),
          timezone: first.start!.tzid ?? FISH_CONFIG.timezone,
          booking: signals.booking,
          spaces_limited: signals.spaces_limited,
          transport_available: signals.transport_available,
          audience_snippets: signals.audience_snippets,
          explicit_older: signals.explicit_older,
          title_may_contain_person_name: titleMayContainPersonName(first.summary!.trim()),
        },
      };
      const physicalText = [item.title, categories.join(' '), ...signals.audience_snippets].join(' ');
      return { item, signals, physical_hint: PHYSICAL.test(physicalText), occurrence_urls: urls, locations_differ: locations.length > 1 };
    });

    series.sort((a, b) => a.item.title.localeCompare(b.item.title));
    return { items: series.map(s => s.item), errors, series, events_read: events.length };
  }
}

/** Recorrência OBSERVADA nas datas da janela do ICS (não é declarada pela fonte). */
export function observedRecurrence(occurrences: RawOccurrence[]): string {
  const dates = [...new Set(occurrences.map(o => o.date))].sort();
  if (dates.length < 2) return 'ocorrência única na janela do ICS';
  const gaps = dates.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dates[i]!)) / 86_400_000);
  if (gaps.every(g => g === 7)) return 'semanal (observado)';
  if (gaps.every(g => g === 14)) return 'quinzenal (observado)';
  if (gaps.every(g => g % 7 === 0)) return 'mesmo dia da semana, intervalos irregulares (observado)';
  return 'irregular (observado)';
}
