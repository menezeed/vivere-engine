/**
 * Piloto UK (U3, 26/11/2026) — caminho EN da detecção de recorrência.
 * Textos no formato do campo "When" da u3a SiteWorks (sintéticos, sem dados pessoais).
 */
import { describe, it, expect } from 'vitest';
import { detectRecurrence } from '../detectRecurrence';
import { toHHMM } from '../detectRecurrenceEn';
import type { RawActivityItem } from '../../../../types/RawActivityItem';

function en(when: string | null, overrides: Partial<RawActivityItem> = {}): RawActivityItem {
  return {
    source_key: 'u3a_richmond', source_item_id: 'group:1', collected_at: '2026-11-26T00:00:00Z',
    title: 'Group', description: null, raw_category_text: null, occurrences: [],
    recurrence_text_hint: when, venue_mention: null, price_text: null, is_free_hint: null,
    image_url: null, external_url: null, contact_phone: null, contact_email: null,
    language: 'en', raw_payload: {}, ...overrides,
  };
}
const rec = (when: string | null) => detectRecurrence(en(when)).recurrence;

describe('toHHMM', () => {
  it.each([
    ['10:00 AM', '10:00'], ['12:00 PM', '12:00'], ['12:30 AM', '00:30'], ['2:30 PM', '14:30'],
    ['4pm', '16:00'], ['9.15am', '09:15'], ['14:00', '14:00'],
  ])('%s → %s', (input, out) => expect(toHHMM(input)).toBe(out));
  it.each(['10', '13:00 PM', '25:00', '10:75'])('%s → null', (input) => expect(toHHMM(input)).toBeNull());
});

describe('detectRecurrence — caminho EN', () => {
  it('weekly + intervalo → início e review de fim não persistido', () => {
    expect(rec('Weekly on Thursday mornings 10:00 AM-11:00 AM')).toEqual({
      recurrence_type: 'weekly', recurrence_days: [4], recurrence_time: '10:00',
      review_reasons: ['recurrence_end_time_not_persisted'],
    });
  });

  it('fortnightly → biweekly', () => {
    expect(rec('Fortnightly on Monday afternoons 2:30 PM-4:30 PM')).toMatchObject({
      recurrence_type: 'biweekly', recurrence_days: [1], recurrence_time: '14:30',
    });
  });

  it('monthly com dia e hora única, sem ordinal → monthly, sem review', () => {
    expect(rec('Monthly on Wednesdays 12:00 PM')).toEqual({
      recurrence_type: 'monthly', recurrence_days: [3], recurrence_time: '12:00', review_reasons: [],
    });
  });

  it.each([
    'Monthly on Thursdays 3rd Thursday',
    'Monthly on Tuesday afternoons 2:00 PM-3:15 PM First Tuesday',
    'Monthly on Fridays last Friday',
  ])('ordinal mensal não representável: %s', (when) => {
    expect(rec(when)).toEqual({
      recurrence_type: null, recurrence_days: null, recurrence_time: null,
      review_reasons: ['recurrence_ordinal_month_not_representable'],
    });
  });

  it('frequência sem dia → tipo sem dias (nada inventado)', () => {
    expect(rec('Weekly')).toEqual({ recurrence_type: 'weekly', recurrence_days: null, recurrence_time: null, review_reasons: [] });
  });

  it('sem frequência explícita → sem recorrência', () => {
    expect(rec('On Monday mornings 10:15 AM').recurrence_type).toBeNull();
    expect(rec('Various dates').recurrence_type).toBeNull();
  });

  it('horas distintas → null + review por-dia', () => {
    expect(rec('Weekly on Tuesdays 10:00 AM and Thursdays 2:00 PM')).toMatchObject({
      recurrence_type: 'weekly', recurrence_days: [2, 4], recurrence_time: null,
      review_reasons: ['recurrence_per_day_times_not_representable'],
    });
  });

  it('hint vazio ou null → sem recorrência e item intacto', () => {
    const item = en(null);
    const r = detectRecurrence(item);
    expect(r.item).toBe(item);
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('isolamento: o mesmo texto em PT não passa pelo caminho EN', () => {
    const r = detectRecurrence(en('Weekly on Thursday mornings 10:00 AM-11:00 AM', { language: 'pt' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });
});
