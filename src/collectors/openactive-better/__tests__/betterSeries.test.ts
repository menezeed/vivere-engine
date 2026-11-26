/**
 * Parser puro Better OpenActive: fixtures sintéticas, sem rede nem BD.
 */
import { describe, it, expect } from 'vitest';
import {
  fromSessionSeries, selectRichmondSeries, generateOccurrences, londonLocalToUtc, planFromSeries,
  splitByExisting, normalizePostcode, isRichmondPostcode, parseWeekday, priceText, GENERAL_ADULT_EVIDENCE,
  type RpdeItem, type BetterSchedule,
} from '../betterSeries';
import { BETTER_CONFIG } from '../config';

const sched = (o: Partial<Record<string, unknown>> = {}) => ({
  '@type': 'Schedule', byDay: ['https://schema.org/Monday'], startTime: '11:30', endTime: '12:15',
  repeatFrequency: 'P1W', startDate: '2026-04-01', scheduleTimezone: 'Europe/London', ...o,
});

function series(id: string, o: { name?: string; postcode?: string; schedule?: unknown[]; ageRange?: unknown; offers?: unknown[]; extra?: Record<string, unknown> } = {}): RpdeItem {
  return {
    state: 'updated', kind: 'SessionSeries', id, modified: 1_750_000_000,
    data: {
      '@type': 'SessionSeries', identifier: id, name: o.name ?? 'Aqua Aerobics', url: `https://www.better.org.uk/leisure-centre/x/${id}`,
      description: 'Join Jane Smith on 020 8123 4567 for a splash!',
      leader: [{ '@type': 'Person', name: 'Jane Smith' }],
      organizer: { '@type': 'Organization', name: 'Better' },
      activity: [{ '@type': 'Concept', prefLabel: 'Aqua Aerobics' }],
      ageRange: o.ageRange ?? { minValue: 16, maxValue: 110 },
      offers: o.offers ?? [{ name: 'Adult', price: 8.8, priceCurrency: 'GBP' }],
      location: { name: 'Teddington Pools and Fitness Centre', address: { streetAddress: 'Vicarage Road', addressLocality: 'Teddington', postalCode: o.postcode ?? 'TW11 8EZ' } },
      eventSchedule: o.schedule ?? [sched()],
      ...o.extra,
    },
  };
}

const TODAY = '2026-11-26'; // quinta-feira

describe('filtro (Richmond, apagados, expirados)', () => {
  it('só áreas postais de Richmond (outward code completo)', () => {
    expect(isRichmondPostcode(normalizePostcode('tw98 2sf'))).toBe(false); // TW98 ≠ TW9
    expect(isRichmondPostcode(normalizePostcode('TW92SF'))).toBe(true);
    expect(isRichmondPostcode(normalizePostcode('TW13 4AB'))).toBe(false); // Feltham, fora
    expect(isRichmondPostcode(normalizePostcode('SW1A 1AA'))).toBe(false);
    expect(isRichmondPostcode(normalizePostcode('SW14 8SN'))).toBe(true);
    const items = [series('a', { postcode: 'TW11 8EZ' }), series('b', { postcode: 'TW13 4AB' }), series('c', { postcode: 'SW19 1AA' }), series('d', { postcode: 'tw9 2sf' })];
    expect(selectRichmondSeries(items).map(s => s.identifier).sort()).toEqual(['a', 'd']);
  });

  it('apagados saem, incluindo um delete posterior a um update', () => {
    const items: RpdeItem[] = [series('a'), series('b'), { state: 'deleted', kind: 'SessionSeries', id: 'a', modified: 1_760_000_000 }];
    expect(selectRichmondSeries(items).map(s => s.identifier)).toEqual(['b']);
  });

  it('endDate no passado sai; sem endDate ou endDate >= hoje fica', () => {
    const items = [
      series('old', { schedule: [sched({ endDate: '2026-09-30' })] }),
      series('today', { schedule: [sched({ endDate: TODAY })] }),
      series('open', { schedule: [sched()] }),
    ];
    const plan = planFromSeries(selectRichmondSeries(items), TODAY, '2026-11-26T12:00:00Z');
    expect(plan.expired.map(e => e.source_item_id)).toEqual(['series:old']);
    // 'today' termina hoje (quinta), não há segunda na janela → fora da inserção, mas não expirada.
    expect(plan.held.map(h => h.source_item_id)).toEqual(['series:today']);
    expect(fromSessionSeries(items, TODAY).map(i => i.source_item_id)).toEqual(['series:open']);
  });
});

describe('ocorrências (eventSchedule, Europe/London)', () => {
  const s = (o: Partial<BetterSchedule>): BetterSchedule => ({
    by_day: ['monday'], start_time: '09:30', end_time: '10:25', repeat_frequency: 'P1W', start_date: null, end_date: null, except_dates: [], timezone: 'Europe/London', ...o,
  });

  it('gera as próximas ocorrências em 21 dias (byDay, início e fim)', () => {
    const { occurrences } = generateOccurrences([s({ by_day: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] })], TODAY);
    expect(occurrences).toHaveLength(15);
    expect(occurrences[0]).toEqual({ date: '2026-11-26', time: '09:30', end_date: null, end_time: '10:25' });
    expect(occurrences.at(-1)!.date).toBe('2026-12-16');
  });

  it('respeita startDate, endDate e exceptDate', () => {
    const { occurrences } = generateOccurrences([s({ start_date: '2026-11-30', end_date: '2026-12-14', except_dates: ['2026-12-07'] })], TODAY);
    expect(occurrences.map(o => o.date)).toEqual(['2026-11-30', '2026-12-14']);
  });

  it('BST→GMT: hora local fixa (09:30) e instante UTC muda com o fuso', () => {
    const { occurrences } = generateOccurrences([s({})], '2026-10-19');
    expect(occurrences.map(o => `${o.date} ${o.time}`)).toEqual(['2026-10-19 09:30', '2026-10-26 09:30', '2026-11-02 09:30']);
    expect(londonLocalToUtc('2026-10-19', '09:30')).toBe('2026-10-19T08:30:00Z'); // BST
    expect(londonLocalToUtc('2026-10-26', '09:30')).toBe('2026-10-26T09:30:00Z'); // GMT
    expect(londonLocalToUtc('2026-03-27', '09:30')).toBe('2026-03-27T09:30:00Z'); // GMT
    expect(londonLocalToUtc('2026-03-30', '09:30')).toBe('2026-03-30T08:30:00Z'); // BST
  });

  it('fuso diferente ou frequência não suportada: sem ocorrências inventadas', () => {
    expect(generateOccurrences([s({ timezone: 'America/New_York' })], TODAY).occurrences).toEqual([]);
    const r = generateOccurrences([s({ repeat_frequency: 'P2W' })], TODAY);
    expect(r.occurrences).toEqual([]);
    expect(r.unsupported[0]).toMatch(/P2W/);
  });

  it('byDay em várias formas', () => {
    expect(['https://schema.org/Monday', 'http://schema.org/Tuesday', 'schema:Friday', 'SU'].map(parseWeekday)).toEqual(['monday', 'tuesday', 'friday', 'sunday']);
  });

  it('recorrência declarada pela fonte (hint gerado + raw_payload)', () => {
    const [item] = fromSessionSeries([series('a')], TODAY);
    expect(item!.recurrence_text_hint).toBe('Weekly on Monday 11:30-12:15');
    expect(item!.raw_payload['recurrence']).toEqual({ declared_by_source: true, repeat_frequency: ['P1W'], by_day: ['monday'] });
    expect(item!.occurrences.map(o => o.date)).toEqual(['2026-11-30', '2026-12-07', '2026-12-14']);
  });

  it('P7D (forma usada pela Better) é semanal; vários schedules com a mesma hora são agrupados', () => {
    const [item] = fromSessionSeries([series('a', { schedule: [
      sched({ repeatFrequency: 'P7D', byDay: ['https://schema.org/Monday'], startTime: '09:30', endTime: '10:25' }),
      sched({ repeatFrequency: 'P7D', byDay: ['https://schema.org/Tuesday'], startTime: '09:30', endTime: '10:25' }),
      sched({ repeatFrequency: 'P7D', byDay: ['https://schema.org/Tuesday'], startTime: '18:00', endTime: '18:45' }),
    ] })], TODAY);
    expect(item!.recurrence_text_hint).toBe('Weekly on Monday, Tuesday 09:30-10:25; Weekly on Tuesday 18:00-18:45');
    expect(item!.occurrences).toHaveLength(9);
    expect(item!.occurrences.slice(0, 2)).toEqual([
      { date: '2026-11-30', time: '09:30', end_date: null, end_time: '10:25' },
      { date: '2026-12-01', time: '09:30', end_date: null, end_time: '10:25' },
    ]);
  });
});

describe('elegibilidade', () => {
  const cls = (it: RpdeItem) => {
    const plan = planFromSeries(selectRichmondSeries([it]), TODAY, 'x');
    return plan.proposals[0] ?? plan.held[0];
  };

  it('ageRange.minValue >= 60 → confirmed_60plus (medium, revisão humana)', () => {
    const p = cls(series('s', { name: 'Swim for all', ageRange: { minValue: 60 }, offers: [] })) as { classification: string; confidence: string; human_review_notes: string[] };
    expect(p.classification).toBe('confirmed_60plus');
    expect(p.confidence).toBe('medium');
    expect(p.human_review_notes.join(' ')).toMatch(/revisão humana/);
  });

  it('oferta com ageRestriction.minValue >= 60 → confirmed_60plus', () => {
    const p = cls(series('s', { offers: [{ name: 'Senior', price: 5, priceCurrency: 'GBP', ageRestriction: { minValue: 60 } }] })) as { classification: string };
    expect(p.classification).toBe('confirmed_60plus');
  });

  it('nome com 60+ explícito → confirmed_60plus', () => {
    const p = cls(series('s', { name: 'Swim for 60+', ageRange: { minValue: 16 } })) as { classification: string };
    expect(p.classification).toBe('confirmed_60plus');
  });

  it('sessão geral 16+ → unclear com a evidência fixa (nunca likely_suitable)', () => {
    const p = cls(series('s', { name: 'Group Cycle' })) as { classification: string; evidence: string };
    expect(p.classification).toBe('unclear');
    expect(p.evidence).toBe(GENERAL_ADULT_EVIDENCE);
    const q = cls(series('t', { name: 'Gym', extra: { ageRange: undefined } })) as { classification: string };
    expect(q.classification).toBe('unclear');
    expect(q.classification).not.toBe('likely_suitable');
    // Idade só nas ofertas (como na Better real): mesma evidência 16+.
    const r = cls(series('u', { name: 'Zumba', extra: { ageRange: undefined },
      offers: [{ name: 'Adult', price: 11.7, priceCurrency: 'GBP', ageRestriction: { minValue: 16, maxValue: 110 } }] })) as { classification: string; evidence: string };
    expect(r.classification).toBe('unclear');
    expect(r.evidence).toBe(GENERAL_ADULT_EVIDENCE);
  });

  it('sessão familiar (oferta Child) → unclear com nota', () => {
    const p = cls(series('s', { name: 'Family Fun Swim', extra: { ageRange: undefined },
      offers: [{ name: 'Adult', price: 6.9, priceCurrency: 'GBP' }, { name: 'Child', price: 5.3, priceCurrency: 'GBP' }] })) as { classification: string; human_review_notes: string[] };
    expect(p.classification).toBe('unclear');
    expect(p.human_review_notes.join(' ')).toMatch(/crianças/);
  });

  it('"over 55s" não confirma 60+', () => {
    const p = cls(series('s', { name: 'Over 55s Swim' })) as { classification: string };
    expect(p.classification).not.toBe('confirmed_60plus');
  });

  it('faixa etária infantil → fora da inserção (unsuitable)', () => {
    const h = cls(series('s', { name: 'Junior Swim', ageRange: { minValue: 8, maxValue: 15 } })) as unknown as { reason: string };
    expect(h.reason).toMatch(/fora do público/);
  });
});

describe('privacidade', () => {
  it('sem descrição, leader nem organizer em nenhum campo gravado', () => {
    const [item] = fromSessionSeries([series('a')], TODAY);
    const json = JSON.stringify(item);
    expect(item!.description).toBeNull();
    expect(json).not.toMatch(/Jane|Smith|8123|splash|leader|organizer/i);
    expect(item!.contact_phone).toBeNull();
    expect(item!.contact_email).toBeNull();
    expect(Object.keys(item!.raw_payload).sort()).toEqual([
      'activity_labels', 'age_range', 'eligibility_proposal', 'identifier', 'occurrence_starts_utc', 'occurrence_window_days',
      'offer_age_restrictions', 'postcode', 'recurrence', 'schedule', 'source', 'timezone', 'url',
    ]);
    expect((item!.raw_payload['source'] as { attribution: string }).attribution).toBe(BETTER_CONFIG.licence.attribution);
  });

  it('título com possível nome de instrutor fica fora (revisão manual)', () => {
    const plan = planFromSeries(selectRichmondSeries([series('a', { name: 'Yoga with Jane' })]), TODAY, 'x');
    expect(plan.items).toHaveLength(0);
    expect(plan.held[0]!.title).not.toMatch(/Jane/);
  });

  it('URL fora de better.org.uk ou com query não é guardado', () => {
    const it = series('a', { extra: { url: 'https://evil.example/x?u=1' } });
    expect(fromSessionSeries([it], TODAY)[0]!.external_url).toBeNull();
  });
});

describe('estrutura do item', () => {
  it('source_item_id, venue_mention e preço', () => {
    const [item] = fromSessionSeries([series('12345')], TODAY);
    expect(item!.source_item_id).toBe('series:12345');
    expect(item!.source_key).toBe(BETTER_CONFIG.source_key);
    expect(item!.venue_mention).toEqual({ raw_text: 'Teddington Pools and Fitness Centre', raw_address_text: 'Vicarage Road, Teddington, TW11 8EZ', confidence_hint: 'explicit_name' });
    expect(item!.price_text).toBe('Adult £8.80');
    expect(priceText([{ name: null, price: 0, currency: 'GBP', age_min: null, age_max: null }])).toBe('£0.00');
  });

  it('idempotência: séries já em staging são saltadas', () => {
    const items = fromSessionSeries([series('a'), series('b')], TODAY);
    const r = splitByExisting(items, new Set(['series:a']));
    expect(r.insert.map(i => i.source_item_id)).toEqual(['series:b']);
    expect(r.skip).toEqual(['series:a']);
  });
});
