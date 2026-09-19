/**
 * src/publishing/__tests__/occurrenceSelection.test.ts
 * Sprint 8.7 — ADR-0020. Testes isolados do helper puro.
 */

import { describe, it, expect } from 'vitest';
import { selectNextOccurrence, occurrenceToDateRange } from '../services/occurrenceSelection.js';
import type { ActivityOccurrence } from '../types/domain.js';

const ASOF = new Date('2026-07-09T00:00:00.000Z');

describe('selectNextOccurrence', () => {
  it('devolve null para array vazio', () => {
    expect(selectNextOccurrence([], ASOF)).toBeNull();
  });

  it('devolve null quando todas as ocorrências são anteriores a asOf', () => {
    const occurrences: ActivityOccurrence[] = [
      { date: '2026-01-01', time: null, endDate: null, endTime: null },
      { date: '2026-06-01', time: null, endDate: null, endTime: null },
    ];
    expect(selectNextOccurrence(occurrences, ASOF)).toBeNull();
  });

  it('devolve a única ocorrência futura', () => {
    const occurrence: ActivityOccurrence = { date: '2026-08-01', time: '09:00', endDate: null, endTime: null };
    expect(selectNextOccurrence([occurrence], ASOF)).toEqual(occurrence);
  });

  it('devolve a mais próxima entre várias futuras, independentemente da ordem do array', () => {
    const distante: ActivityOccurrence = { date: '2026-12-01', time: null, endDate: null, endTime: null };
    const proxima:  ActivityOccurrence = { date: '2026-07-15', time: null, endDate: null, endTime: null };
    const media:    ActivityOccurrence = { date: '2026-09-01', time: null, endDate: null, endTime: null };

    expect(selectNextOccurrence([distante, proxima, media], ASOF)).toEqual(proxima);
  });

  it('ignora ocorrências passadas e escolhe a próxima futura, misturadas no array', () => {
    const passada: ActivityOccurrence = { date: '2026-01-01', time: null, endDate: null, endTime: null };
    const futura:  ActivityOccurrence = { date: '2026-07-20', time: null, endDate: null, endTime: null };

    expect(selectNextOccurrence([passada, futura], ASOF)).toEqual(futura);
  });

  it('data igual a asOf (sem time, meia-noite) conta como futura — comparação é >=', () => {
    const occurrence: ActivityOccurrence = { date: '2026-07-09', time: null, endDate: null, endTime: null };
    expect(selectNextOccurrence([occurrence], ASOF)).toEqual(occurrence);
  });

  it('data igual a asOf mas com time posterior à meia-noite também é futura', () => {
    const occurrence: ActivityOccurrence = { date: '2026-07-09', time: '08:00', endDate: null, endTime: null };
    expect(selectNextOccurrence([occurrence], ASOF)).toEqual(occurrence);
  });

  it('um minuto antes de asOf já não conta como futura', () => {
    const asOfComHora = new Date('2026-07-09T08:00:00.000Z');
    const occurrence: ActivityOccurrence = { date: '2026-07-09', time: '07:59', endDate: null, endTime: null };
    expect(selectNextOccurrence([occurrence], asOfComHora)).toBeNull();
  });

  it('é determinístico: mesma entrada + mesmo asOf → mesmo resultado em chamadas repetidas', () => {
    const occurrences: ActivityOccurrence[] = [
      { date: '2026-08-01', time: '09:00', endDate: null, endTime: null },
      { date: '2026-07-20', time: '10:00', endDate: null, endTime: null },
    ];
    const r1 = selectNextOccurrence(occurrences, ASOF);
    const r2 = selectNextOccurrence(occurrences, ASOF);
    expect(r1).toEqual(r2);
  });

  it('não muta o array de entrada', () => {
    const occurrences: ActivityOccurrence[] = [
      { date: '2026-08-01', time: null, endDate: null, endTime: null },
      { date: '2026-07-20', time: null, endDate: null, endTime: null },
    ];
    const snapshot = [...occurrences];
    selectNextOccurrence(occurrences, ASOF);
    expect(occurrences).toEqual(snapshot);
  });
});

describe('occurrenceToDateRange', () => {
  it('combina date + time em startDate; endDate null quando a ocorrência não tem endDate', () => {
    const occurrence: ActivityOccurrence = { date: '2026-08-01', time: '09:00', endDate: null, endTime: null };
    const range = occurrenceToDateRange(occurrence);

    expect(range.startDate).toEqual(new Date('2026-08-01T09:00:00.000Z'));
    expect(range.endDate).toBeNull();
  });

  it('combina endDate + endTime quando presentes', () => {
    const occurrence: ActivityOccurrence = { date: '2026-08-01', time: '09:00', endDate: '2026-08-01', endTime: '10:30' };
    const range = occurrenceToDateRange(occurrence);

    expect(range.endDate).toEqual(new Date('2026-08-01T10:30:00.000Z'));
  });

  it('time ausente assume meia-noite', () => {
    const occurrence: ActivityOccurrence = { date: '2026-08-01', time: null, endDate: null, endTime: null };
    const range = occurrenceToDateRange(occurrence);

    expect(range.startDate).toEqual(new Date('2026-08-01T00:00:00.000Z'));
  });
});
