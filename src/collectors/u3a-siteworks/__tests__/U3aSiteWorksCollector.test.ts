/**
 * Piloto UK (U2/U5) — collector u3a SiteWorks, com fixtures SINTÉTICAS.
 * Nomes, telefones e emails das fixtures são fictícios e servem para provar
 * que NUNCA chegam a nenhum item.
 */
import { describe, it, expect, vi } from 'vitest';
import { U3aSiteWorksCollector } from '../U3aSiteWorksCollector';
import { U3aApiClient, type FetchFn, type U3aWpItem } from '../U3aApiClient';
import { U3A_RICHMOND_CONFIG, UK_PILOT_PRODUCT } from '../config';
import {
  parseGroupFields, parseEventVenue, parseVenueAddress, extractUkPostcode, isPrivateVenue, isOnlineVenue,
  isCancelledTitle, isActiveGroupStatus, normaliseApiTime, htmlToText,
} from '../sanitize';
import { PostcodesIoClient, type PostFetchFn } from '../../geocoding/PostcodesIoClient';

const FAKE_NAME = 'Zed Fictional';
const FAKE_PHONE = '020 0000 0000';
const FAKE_EMAIL = 'zed@example.invalid';

const groupHtml = (status: string, when: string, venue: string) => `
<div class="wp-block-u3a-groupdata"><table class="u3a_group_table">
  <tr><td>Status:</td><td>${status}</td></tr>
  <tr><td>Group leader:</td><td><a href='https://x.invalid/u3a-contact-form?contact_id=1'>${FAKE_NAME}</a></td></tr>
  <tr><td>Tel:</td><td>${FAKE_PHONE}</td></tr>
  <tr><td>Group email:</td><td>${FAKE_EMAIL}</td></tr>
  <tr><td>When:</td><td>${when}</td></tr>
  <tr><td>Venue:</td><td><a href="https://x.invalid/u3a_venue/v">${venue}</a></td></tr>
</table></div><p>Contact ${FAKE_NAME} on ${FAKE_PHONE} to join.</p>`;

const eventHtml = (venue: string) =>
  `<p>Event type: Social Date: 16 December 2026 Time: 12:00 PM Group: Lunches Venue: ${venue} Organiser: ${FAKE_NAME} Booking: call ${FAKE_PHONE}</p>`;

const venueHtml = (addr: string) => `<p>Address: ${addr}</p><p>Accessibility: step-free; call ${FAKE_PHONE}</p>`;

const DATA: Record<string, U3aWpItem[]> = {
  u3a_venue: [
    { id: 10, title: { rendered: 'The Test Arms' }, link: 'https://x.invalid/v/10', content: { rendered: venueHtml('1 High St Twickenham TW1 1AA') } },
    { id: 11, title: { rendered: 'Teddington' }, content: { rendered: '<p>Area only</p>' } },
    { id: 12, title: { rendered: 'Members Home' }, content: { rendered: venueHtml('somewhere TW2 2BB') } },
    { id: 13, title: { rendered: 'ZOOM' }, content: { rendered: '' } },
    { id: 14, title: { rendered: 'Unknown Hall' }, content: { rendered: venueHtml('Road X TW9 9ZZ') } },
  ],
  u3a_group_category: [{ id: 1, name: 'Walking' }, { id: 2, name: 'Section: Recreation' }],
  u3a_group: [
    { id: 20, title: { rendered: 'Nordic Walking' }, link: 'https://x.invalid/g/20', u3a_group_category: [1, 2],
      content: { rendered: groupHtml('Active, open to new members', 'Weekly on Thursday mornings 10:00 AM-11:00 AM', 'The Test Arms') } },
    { id: 21, title: { rendered: 'Old Group' }, content: { rendered: groupHtml('No longer meeting', 'Weekly', 'The Test Arms') } },
    { id: 22, title: { rendered: 'Home Group' }, content: { rendered: groupHtml('Active, full but can join waiting list', 'Monthly', 'Members Home') } },
    { id: 23, title: { rendered: 'Online Group' }, content: { rendered: groupHtml('Active, open to new members', 'Weekly', 'Google Meet') } },
    { id: 24, title: { rendered: 'Rambling' }, content: { rendered: groupHtml('Active, open to new members', 'Monthly on Thursdays 3rd Thursday', 'Various locations') } },
  ],
  u3a_event: [
    { id: 30, title: { rendered: 'Christmas Lunch' }, link: 'https://x.invalid/e/30', eventdate: '2026-12-16', eventstarttime: '12:00', eventendtime: '', eventcategory: ['Social'], content: { rendered: eventHtml('The Test Arms') } },
    { id: 31, title: { rendered: 'CANCELLED - Monthly Meeting' }, eventdate: '2026-12-16', eventstarttime: '14:30', content: { rendered: eventHtml('The Test Arms') } },
    { id: 32, title: { rendered: 'Past Lunch' }, eventdate: '2026-11-18', eventstarttime: '12:00', content: { rendered: eventHtml('The Test Arms') } },
  ],
};

function fakeFetch(): FetchFn {
  return async (url) => {
    const type = url.match(/wp\/v2\/(\w+)\?/)![1]!;
    return { ok: true, status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'x-wp-totalpages' ? '1' : null) }, json: async () => DATA[type] ?? [] };
  };
}

function fakeGeocoder() {
  return {
    lookup: vi.fn(async (pcs: readonly string[]) =>
      new Map(pcs.filter((p) => p === 'TW1 1AA').map((p) => [p, { postcode: p, lat: 51.45, lng: -0.33, admin_district: 'Richmond upon Thames' }]))),
  };
}

function make() {
  const geocoder = fakeGeocoder();
  const c = new U3aSiteWorksCollector(new U3aApiClient('https://x.invalid', 'test', fakeFetch()), geocoder, U3A_RICHMOND_CONFIG, '2026-11-26', () => '2026-11-26T09:00:00Z');
  return { c, geocoder };
}

describe('sanitize — allowlist e privacidade', () => {
  it('parseGroupFields só devolve Status/When/Venue', () => {
    const f = parseGroupFields(groupHtml('Active, open to new members', 'Weekly on Mondays', 'Hall'));
    expect(f).toEqual({ Status: 'Active, open to new members', When: 'Weekly on Mondays', Venue: 'Hall' });
    expect(JSON.stringify(f)).not.toMatch(/Zed|020|example\.invalid|contact_id/);
  });
  it('parseEventVenue corta antes de Organiser/Booking', () => {
    expect(parseEventVenue(eventHtml("The King's Head"))).toBe("The King's Head");
  });
  it('parseVenueAddress e extractUkPostcode', () => {
    expect(parseVenueAddress(venueHtml('306, Richmond Road Twickenham TW1 2PD'))).toBe('306, Richmond Road Twickenham TW1 2PD');
    expect(extractUkPostcode('x tw11 8hg y')).toBe('TW11 8HG');
    expect(extractUkPostcode('Teddington')).toBeNull();
  });
  it('classificadores', () => {
    expect(isPrivateVenue('Members Home')).toBe(true);
    expect(isPrivateVenue("Member's home")).toBe(true);
    expect(isPrivateVenue('Clarendon Hall')).toBe(false);
    expect(isOnlineVenue('ZOOM')).toBe(true);
    expect(isOnlineVenue('Google Meet')).toBe(true);
    expect(isCancelledTitle('CANCELLED - MONTHLY MEETING')).toBe(true);
    expect(isCancelledTitle('Pub Lunch')).toBe(false);
    expect(isActiveGroupStatus('Active, full but can join waiting list')).toBe(true);
    expect(isActiveGroupStatus('No longer meeting')).toBe(false);
    expect(normaliseApiTime('9:05')).toBe('09:05');
    expect(normaliseApiTime('')).toBeNull();
    expect(htmlToText('<b>Fish &amp; Chips</b>&nbsp;&#8211; ok')).toBe('Fish & Chips - ok');
  });
});

describe('U3aSiteWorksCollector — venues (U5 postcodes.io)', () => {
  it('só geocodifica venues com código postal, públicos e físicos; nada inventado', async () => {
    const { c, geocoder } = make();
    const { items, errors } = await c.collectVenues();
    expect(geocoder.lookup).toHaveBeenCalledWith(['TW1 1AA', 'TW9 9ZZ']); // nunca o privado
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source_key: 'u3a_richmond', source_item_id: 'venue:10', name: 'The Test Arms', lat: 51.45, lng: -0.33,
      phone: null, google_types: [], source_region_label: 'Richmond upon Thames, London',
    });
    expect(errors.map((e) => e.message).sort()).toEqual(['skip:no_postcode', 'skip:online_venue', 'skip:postcode_not_found', 'skip:private_venue']);
  });
});

describe('U3aSiteWorksCollector — actividades', () => {
  it('eventos futuros não cancelados + grupos activos; exclusões com motivo', async () => {
    const { c } = make();
    const { items, errors } = await c.collectActivities();
    expect(items.map((i) => i.source_item_id)).toEqual(['event:30', 'group:20', 'group:24']);
    expect(errors.map((e) => e.message).sort()).toEqual(['skip:cancelled', 'skip:inactive_group', 'skip:online_only', 'skip:past_event', 'skip:private_venue']);

    const ev = items[0]!;
    expect(ev.occurrences).toEqual([{ date: '2026-12-16', time: '12:00', end_date: null, end_time: null }]);
    expect(ev.venue_mention).toEqual({ raw_text: 'The Test Arms', raw_address_text: '1 High St Twickenham TW1 1AA', confidence_hint: 'explicit_name' });
    expect(ev.language).toBe('en');

    const g = items[1]!;
    expect(g.recurrence_text_hint).toBe('Weekly on Thursday mornings 10:00 AM-11:00 AM');
    expect(g.raw_category_text).toBe('Walking'); // "Section: …" só quando não há categoria temática
    expect(g.occurrences).toEqual([]);
    expect(items[2]!.venue_mention).toBeNull(); // "Various locations"
  });

  it('PRIVACIDADE: nenhum nome, telefone, email ou contacto em nenhum item ou payload', async () => {
    const { c } = make();
    const all = JSON.stringify([await c.collectActivities(), await c.collectVenues()]);
    expect(all).not.toContain(FAKE_NAME);
    expect(all).not.toContain(FAKE_PHONE);
    expect(all).not.toContain(FAKE_EMAIL);
    expect(all).not.toContain('contact_id');
    for (const i of (await c.collectActivities()).items) {
      expect(i.contact_phone).toBeNull();
      expect(i.contact_email).toBeNull();
      expect(i.description).toBeNull();
    }
  });

  it('isolamento: produto do piloto UK, nunca o produto BR', () => {
    expect(U3A_RICHMOND_CONFIG.product_key).toBe(UK_PILOT_PRODUCT);
    expect(U3A_RICHMOND_CONFIG.product_key).not.toBe('vivere-60-mais');
    expect(U3A_RICHMOND_CONFIG.timezone).toBe('Europe/London');
  });

  it('lê a fonte uma única vez (cache) para venues e actividades', async () => {
    const fetchSpy = vi.fn(fakeFetch());
    const c = new U3aSiteWorksCollector(new U3aApiClient('https://x.invalid', 'test', fetchSpy), fakeGeocoder(), U3A_RICHMOND_CONFIG, '2026-11-26');
    await c.collectVenues();
    await c.collectActivities();
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    for (const call of fetchSpy.mock.calls) expect(call[1]?.method).toBe('GET');
  });
});

describe('U3aApiClient — paginação e erros', () => {
  it('segue X-WP-TotalPages', async () => {
    const pages: Record<string, U3aWpItem[]> = { '1': [{ id: 1 }], '2': [{ id: 2 }] };
    const f: FetchFn = async (url) => ({ ok: true, status: 200, headers: { get: () => '2' }, json: async () => pages[url.match(/[?&]page=(\d+)/)![1]!] });
    expect((await new U3aApiClient('https://x.invalid', 't', f).fetchAll('u3a_group')).map((i) => i.id)).toEqual([1, 2]);
  });
  it('HTTP de erro lança', async () => {
    const f: FetchFn = async () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => [] });
    await expect(new U3aApiClient('https://x.invalid', 't', f).fetchAll('u3a_event')).rejects.toThrow(/HTTP 503/);
  });
});

describe('PostcodesIoClient (U5)', () => {
  it('lote POST, normaliza, ignora não encontrados, só envia códigos postais', async () => {
    const fetchFn = vi.fn<PostFetchFn>(async () => ({
      ok: true, status: 200,
      json: async () => ({ status: 200, result: [
        { query: 'TW1 1AA', result: { postcode: 'TW1 1AA', latitude: 51.4, longitude: -0.3, admin_district: 'Richmond upon Thames' } },
        { query: 'TW9 9ZZ', result: null },
      ] }),
    }));
    const m = await new PostcodesIoClient(fetchFn).lookup(['tw1 1aa', 'TW9 9ZZ', 'TW1 1AA']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.postcodes.io/postcodes');
    expect(JSON.parse(init.body)).toEqual({ postcodes: ['TW1 1AA', 'TW9 9ZZ'] });
    expect([...m.keys()]).toEqual(['TW1 1AA']);
    expect(m.get('TW1 1AA')).toEqual({ postcode: 'TW1 1AA', lat: 51.4, lng: -0.3, admin_district: 'Richmond upon Thames' });
  });
  it('HTTP de erro lança (sem coordenadas inventadas)', async () => {
    const fetchFn: PostFetchFn = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await expect(new PostcodesIoClient(fetchFn).lookup(['TW1 1AA'])).rejects.toThrow(/HTTP 429/);
  });
});
