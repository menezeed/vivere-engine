/**
 * Collector u3a SiteWorks — piloto UK (U2, 26/11/2026).
 *
 * Uma leitura da WP REST pública (só GET) alimenta dois contratos:
 *  - venues (u3a_venue) → RawVenueItem, com lat/lng do postcodes.io (U5);
 *  - actividades: eventos datados (u3a_event) e grupos recorrentes
 *    (u3a_group) → RawActivityItem (language 'en').
 *
 * PRIVACIDADE (obrigatório): nenhum nome de pessoa, telefone, email ou
 * link de contacto chega a um item. Os parsers (sanitize.ts) só lêem
 * campos em allowlist; raw_payload é um subconjunto construído aqui —
 * NUNCA content.rendered. contact_phone/contact_email são sempre null.
 *
 * Exclusões (contadas como erros com motivo, nada inventado):
 *  - venue privado (casa de membros), online, sem código postal, código
 *    postal não encontrado no postcodes.io;
 *  - evento passado (antes de `today`) ou cancelado;
 *  - grupo inactivo, ou que reúne em casa de membros / só online.
 */
import type { RawActivityItem, VenueMention } from '../../types/RawActivityItem';
import type { RawVenueItem } from '../../types/RawVenueItem';
import type { ActivityCollectorContract, VenueCollectorContract } from '../../persistence/types/collectorContracts';
import type { PostcodesIoClient, PostcodeGeo } from '../geocoding/PostcodesIoClient';
import type { U3aApiClient, U3aWpItem } from './U3aApiClient';
import type { U3aSourceConfig } from './config';
import {
  extractUkPostcode, htmlToText, isActiveGroupStatus, isCancelledTitle, isOnlineVenue, isPrivateVenue,
  isUnspecifiedVenue, normaliseApiTime, parseEventVenue, parseGroupFields, parseVenueAddress,
} from './sanitize';

type CollectError = { message: string; source_item_id: string | null };

export interface U3aVenueRecord {
  wpId: number;
  name: string;
  address: string | null;
  postcode: string | null;
  link: string | null;
}

interface Loaded {
  events: U3aWpItem[];
  groups: U3aWpItem[];
  venues: U3aVenueRecord[];
  categories: Map<number, string>;
}

export class U3aSiteWorksCollector {
  private loaded: Promise<Loaded> | null = null;

  constructor(
    private readonly api: U3aApiClient,
    private readonly geocoder: Pick<PostcodesIoClient, 'lookup'>,
    private readonly config: U3aSourceConfig,
    /** 'YYYY-MM-DD' local da região (Europe/London) — eventos anteriores são excluídos. */
    private readonly today: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private load(): Promise<Loaded> {
    this.loaded ??= (async () => {
      const [events, groups, venuesRaw, cats] = await Promise.all([
        this.api.fetchAll('u3a_event'),
        this.api.fetchAll('u3a_group'),
        this.api.fetchAll('u3a_venue'),
        this.api.fetchAll('u3a_group_category'),
      ]);
      const venues = venuesRaw.map((v) => {
        const address = parseVenueAddress(v.content?.rendered ?? '');
        return {
          wpId: v.id,
          name: htmlToText(v.title?.rendered),
          address,
          postcode: extractUkPostcode(address),
          link: v.link ?? null,
        };
      });
      const categories = new Map(cats.map((c) => [c.id, htmlToText(c.name ?? '')]));
      return { events, groups, venues, categories };
    })();
    return this.loaded;
  }

  private sourceItemId(kind: 'event' | 'group' | 'venue', id: number): string {
    return `${kind}:${id}`;
  }

  // ── venues ────────────────────────────────────────────────────────────────

  venueCollector(): VenueCollectorContract {
    return { sourceKey: this.config.source_key, collect: () => this.collectVenues() };
  }

  async collectVenues(): Promise<{ items: RawVenueItem[]; errors: CollectError[] }> {
    const { venues } = await this.load();
    const errors: CollectError[] = [];
    const candidates: U3aVenueRecord[] = [];
    for (const v of venues) {
      const id = this.sourceItemId('venue', v.wpId);
      if (isPrivateVenue(v.name)) errors.push({ message: 'skip:private_venue', source_item_id: id });
      else if (isOnlineVenue(v.name)) errors.push({ message: 'skip:online_venue', source_item_id: id });
      else if (!v.postcode) errors.push({ message: 'skip:no_postcode', source_item_id: id });
      else candidates.push(v);
    }

    const geo = candidates.length ? await this.geocoder.lookup(candidates.map((v) => v.postcode!)) : new Map<string, PostcodeGeo>();
    const collectedAt = this.now();
    const items: RawVenueItem[] = [];
    for (const v of candidates) {
      const g = geo.get(v.postcode!);
      const id = this.sourceItemId('venue', v.wpId);
      if (!g) {
        errors.push({ message: 'skip:postcode_not_found', source_item_id: id });
        continue;
      }
      items.push({
        source_key: this.config.source_key,
        source_item_id: id,
        collected_at: collectedAt,
        name: v.name,
        address: v.address,
        lat: g.lat,
        lng: g.lng,
        phone: null,
        website: v.link,
        opening_hours_raw: null,
        image_url: null,
        source_category_hint: 'u3a_venue',
        source_query_text: `${this.config.base_url}/wp-json/wp/v2/u3a_venue`,
        source_query_kind: 'place_type',
        source_region_label: this.config.region_label,
        google_types: [],
        google_business_status: 'OPERATIONAL',
        raw_payload: {
          wp_id: v.wpId,
          wp_type: 'u3a_venue',
          link: v.link,
          address: v.address,
          postcode: v.postcode,
          geocoder: 'postcodes.io',
          geocoded_postcode: g.postcode,
          admin_district: g.admin_district,
        },
      });
    }
    return { items, errors };
  }

  // ── actividades ───────────────────────────────────────────────────────────

  activityCollector(): ActivityCollectorContract {
    return { sourceKey: this.config.source_key, collect: () => this.collectActivities() };
  }

  private venueMention(venueText: string | null, venues: readonly U3aVenueRecord[]): VenueMention | null {
    if (!venueText || isUnspecifiedVenue(venueText)) return null;
    const known = venues.find((v) => v.name.toLowerCase() === venueText.toLowerCase());
    return {
      raw_text: venueText,
      raw_address_text: known?.address ?? null,
      confidence_hint: known ? 'explicit_name' : 'ambiguous',
    };
  }

  private base(id: string, title: string, link: string | null, collectedAt: string): RawActivityItem {
    return {
      source_key: this.config.source_key,
      source_item_id: id,
      collected_at: collectedAt,
      title,
      description: null, // o texto livre da u3a contém contactos pessoais — não é copiado
      raw_category_text: null,
      occurrences: [],
      recurrence_text_hint: null,
      venue_mention: null,
      price_text: null,
      is_free_hint: null,
      image_url: null,
      external_url: link,
      contact_phone: null,
      contact_email: null,
      language: 'en',
      raw_payload: {},
    };
  }

  async collectActivities(): Promise<{ items: RawActivityItem[]; errors: CollectError[] }> {
    const { events, groups, venues, categories } = await this.load();
    const collectedAt = this.now();
    const items: RawActivityItem[] = [];
    const errors: CollectError[] = [];

    for (const e of events) {
      const id = this.sourceItemId('event', e.id);
      const title = htmlToText(e.title?.rendered);
      const date = (e.eventdate ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push({ message: 'skip:event_without_date', source_item_id: id }); continue; }
      if (date < this.today) { errors.push({ message: 'skip:past_event', source_item_id: id }); continue; }
      if (isCancelledTitle(title)) { errors.push({ message: 'skip:cancelled', source_item_id: id }); continue; }
      const venueText = parseEventVenue(e.content?.rendered ?? '');
      if (isPrivateVenue(venueText)) { errors.push({ message: 'skip:private_venue', source_item_id: id }); continue; }
      const category = [].concat((e.eventcategory ?? []) as never).map(String).map(htmlToText).filter(Boolean).join(', ');
      items.push({
        ...this.base(id, title, e.link ?? null, collectedAt),
        raw_category_text: category || null,
        occurrences: [{ date, time: normaliseApiTime(e.eventstarttime), end_date: null, end_time: normaliseApiTime(e.eventendtime) }],
        venue_mention: isOnlineVenue(venueText) ? null : this.venueMention(venueText, venues),
        raw_payload: {
          wp_id: e.id, wp_type: 'u3a_event', link: e.link ?? null, modified_gmt: e.modified_gmt ?? null,
          eventdate: date, eventstarttime: e.eventstarttime ?? null, eventendtime: e.eventendtime ?? null,
          eventcategory: category || null, eventgroup: e.eventgroup ? htmlToText(e.eventgroup) : null,
          venue_text: venueText, timezone: this.config.timezone,
        },
      });
    }

    for (const g of groups) {
      const id = this.sourceItemId('group', g.id);
      const title = htmlToText(g.title?.rendered);
      const fields = parseGroupFields(g.content?.rendered ?? '');
      if (!isActiveGroupStatus(fields.Status)) { errors.push({ message: 'skip:inactive_group', source_item_id: id }); continue; }
      if (isPrivateVenue(fields.Venue)) { errors.push({ message: 'skip:private_venue', source_item_id: id }); continue; }
      if (isOnlineVenue(fields.Venue)) { errors.push({ message: 'skip:online_only', source_item_id: id }); continue; }
      const cats = (g.u3a_group_category ?? []).map((c) => categories.get(c)).filter((c): c is string => !!c);
      const topical = cats.filter((c) => !/^Section\b/i.test(c));
      items.push({
        ...this.base(id, title, g.link ?? null, collectedAt),
        raw_category_text: (topical.length ? topical : cats).join(', ') || null,
        recurrence_text_hint: fields.When ?? null,
        venue_mention: this.venueMention(fields.Venue ?? null, venues),
        raw_payload: {
          wp_id: g.id, wp_type: 'u3a_group', link: g.link ?? null, modified_gmt: g.modified_gmt ?? null,
          status_text: fields.Status ?? null, when_text: fields.When ?? null, venue_text: fields.Venue ?? null,
          categories: cats, members_only: true, timezone: this.config.timezone,
        },
      });
    }

    return { items, errors };
  }
}
