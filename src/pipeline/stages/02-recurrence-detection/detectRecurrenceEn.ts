/**
 * 02-recurrence-detection — caminho EN (piloto UK, U3, 26/11/2026).
 *
 * Isolado do caminho pt-BR: detectRecurrence() só delega aqui quando
 * item.language === 'en'. O comportamento PT não muda.
 *
 * Entrada típica (u3a SiteWorks, campo "When", em recurrence_text_hint):
 *   "Weekly on Thursday mornings 10:00 AM-11:00 AM"
 *   "Fortnightly on Monday afternoons 2:30 PM-4:30 PM"
 *   "Monthly on Wednesdays 12:00 PM"
 *   "Monthly on Thursdays 3rd Thursday"
 *
 * Regras (ADR-0003, nunca inventar):
 *  - a frequência tem de estar EXPLÍCITA (weekly / fortnightly / monthly e
 *    sinónimos); sem ela não há recorrência (o texto fica no hint);
 *  - ordinal mensal ("3rd Thursday", "first Tuesday", "last Friday") não é
 *    representável → recurrence_type null + review
 *    'recurrence_ordinal_month_not_representable' (igual ao caminho PT);
 *  - hora ausente → recurrence_time null; intervalo → início + review
 *    'recurrence_end_time_not_persisted'; várias horas distintas → null +
 *    'recurrence_per_day_times_not_representable'.
 */

import type { RawActivityItem } from '../../../types/RawActivityItem.js';
import type { RecurrenceDetectedItem, RecurrenceReviewReason, RecurrenceType } from './types.js';

const DAYS: readonly [RegExp, number][] = [
  [/\bsundays?\b/i, 0],
  [/\bmondays?\b/i, 1],
  [/\btuesdays?\b/i, 2],
  [/\bwednesdays?\b/i, 3],
  [/\bthursdays?\b/i, 4],
  [/\bfridays?\b/i, 5],
  [/\bsaturdays?\b/i, 6],
];

const WEEKLY = /\b(weekly|every\s+week|each\s+week)\b/i;
const BIWEEKLY = /\b(fortnightly|every\s+(other|second)\s+week|alternate\s+weeks?|bi-?weekly)\b/i;
const MONTHLY = /\b(monthly|every\s+month|each\s+month|once\s+a\s+month)\b/i;
const ORDINAL_MONTH =
  /\b(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth|last)\s+(mon|tues|wednes|thurs|fri|satur|sun)day\b/i;

// Intervalo "10:00 AM-11:00 AM" / "2:30pm - 4pm" / "14:00-16:00".
const TIME_TOKEN = String.raw`\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)|\d{1,2}[:.]\d{2}`;
const RANGE = new RegExp(String.raw`(${TIME_TOKEN})\s*(?:-|–|to)\s*(${TIME_TOKEN})`, 'gi');
const SINGLE = new RegExp(TIME_TOKEN, 'gi');

/** "2:30 PM" → "14:30"; "10am" → "10:00"; "14:00" → "14:00". null se inválido. */
export function toHHMM(token: string): string | null {
  const m = token.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  if (!ampm && m[2] === undefined) return null; // "10" sozinho não é hora
  if (min > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === 'am' && h === 12) h = 0;
    if (ampm === 'pm' && h !== 12) h += 12;
  } else if (h > 23) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function candidateText(item: RawActivityItem): string {
  return (item.recurrence_text_hint ?? '').trim();
}

const NONE = { recurrence_type: null, recurrence_days: null, recurrence_time: null, review_reasons: [] } as const;

export function detectRecurrenceEn(item: RawActivityItem): RecurrenceDetectedItem {
  const text = candidateText(item);
  if (text === '') return { item, recurrence: NONE };

  const type: RecurrenceType | null = BIWEEKLY.test(text)
    ? 'biweekly'
    : WEEKLY.test(text)
      ? 'weekly'
      : MONTHLY.test(text)
        ? 'monthly'
        : null;
  if (type === null) return { item, recurrence: NONE };

  if (ORDINAL_MONTH.test(text)) {
    return {
      item,
      recurrence: { ...NONE, review_reasons: ['recurrence_ordinal_month_not_representable'] },
    };
  }

  const days = DAYS.filter(([re]) => re.test(text)).map(([, n]) => n);
  const reasons: RecurrenceReviewReason[] = [];

  const ranges = [...text.matchAll(RANGE)];
  const masked = text.replace(RANGE, ' ');
  const singles = (masked.match(SINGLE) ?? []).map(toHHMM).filter((t): t is string => t !== null);
  const starts = [...ranges.map((r) => toHHMM(r[1]!)).filter((t): t is string => t !== null), ...singles];
  const distinct = [...new Set(starts)];

  let time: string | null = null;
  if (distinct.length === 1) {
    time = distinct[0]!;
    if (ranges.length > 0) reasons.push('recurrence_end_time_not_persisted');
  } else if (distinct.length > 1) {
    reasons.push('recurrence_per_day_times_not_representable');
  }

  return {
    item,
    recurrence: {
      recurrence_type: type,
      recurrence_days: days.length > 0 ? days : null,
      recurrence_time: time,
      review_reasons: reasons,
    },
  };
}
