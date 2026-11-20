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

  it('um minuto antes de asOf já não conta como futura (hora local UTC−3)', () => {
    // 15/11/2026: asOf = 08:00 locais (11:00Z); ocorrência às 07:59 locais.
    const asOfComHora = new Date('2026-07-09T11:00:00.000Z');
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


// 15/11/2026 — fuso: comparação na hora local das fontes (UTC−3); armazenamento inalterado.
import { occurrenceComparisonInstant, occurrenceToDateRange as toRange, SOURCE_LOCAL_UTC_OFFSET } from '../services/occurrenceSelection.js';

describe('occurrenceSelection — hora local (America/Sao_Paulo, UTC−3)', () => {
  const corrida: ActivityOccurrence = { date: '2026-12-31', time: '06:00', endDate: null, endTime: null };

  it('o deslocamento das fontes é −03:00', () => {
    expect(SOURCE_LOCAL_UTC_OFFSET).toBe('-03:00');
  });

  it('regressão Corrida (06:00 locais): às 03:01 locais (06:01Z) ainda é futura', () => {
    expect(selectNextOccurrence([corrida], new Date('2026-12-31T06:01:00Z'))).toEqual(corrida);
  });

  it('… às 05:59 locais ainda é futura e às 06:01 locais já passou', () => {
    expect(selectNextOccurrence([corrida], new Date('2026-12-31T08:59:00Z'))).toEqual(corrida);
    expect(selectNextOccurrence([corrida], new Date('2026-12-31T09:01:00Z'))).toBeNull();
  });

  it('só data: conta até ao fim do dia local (antes expirava às 21:00 locais da véspera)', () => {
    const soData: ActivityOccurrence = { date: '2026-12-24', time: null, endDate: null, endTime: null };
    expect(selectNextOccurrence([soData], new Date('2026-12-24T00:30:00Z'))).toEqual(soData); // 23/12 21:30 locais
    expect(selectNextOccurrence([soData], new Date('2026-12-24T23:00:00Z'))).toEqual(soData); // 24/12 20:00 locais
    expect(selectNextOccurrence([soData], new Date('2026-12-25T02:59:00Z'))).toEqual(soData); // 24/12 23:59 locais
    expect(occurrenceComparisonInstant(soData).toISOString()).toBe('2026-12-25T02:59:59.999Z');
    expect(selectNextOccurrence([soData], new Date('2026-12-25T02:59:59.500Z'))).toEqual(soData); // últimos ms do dia local
    expect(selectNextOccurrence([soData], new Date('2026-12-25T03:00:00.000Z'))).toBeNull();      // meia-noite local seguinte
  });

  it('ordenação usa o instante real: evento com hora antes do só-data do mesmo dia', () => {
    const comHora: ActivityOccurrence = { date: '2026-12-24', time: '10:00', endDate: null, endTime: null };
    const soData: ActivityOccurrence = { date: '2026-12-24', time: null, endDate: null, endTime: null };
    expect(selectNextOccurrence([soData, comHora], new Date('2026-12-24T12:00:00Z'))).toEqual(comHora);
  });

  it('armazenamento inalterado: start_date = hora local com sufixo Z (app usa slice(0,10))', () => {
    expect(toRange(corrida).startDate.toISOString()).toBe('2026-12-31T06:00:00.000Z');
    const noite: ActivityOccurrence = { date: '2026-12-31', time: '22:30', endDate: null, endTime: null };
    expect(toRange(noite).startDate.toISOString().slice(0, 10)).toBe('2026-12-31'); // nunca passa para 01/01
    const soData: ActivityOccurrence = { date: '2026-12-24', time: null, endDate: null, endTime: null };
    expect(toRange(soData).startDate.toISOString()).toBe('2026-12-24T00:00:00.000Z');
  });

  it('hora inválida continua a não ser seleccionada (comportamento anterior)', () => {
    expect(selectNextOccurrence([{ date: '2026-12-31', time: 'abc', endDate: null, endTime: null }], new Date('2026-11-15T12:00:00Z'))).toBeNull();
  });
});

// Contrato com a vista public.active_activities (baseline 0000): predicado
// reproduzido e ligado ao SQL. Documenta a LIMITAÇÃO CONHECIDA (ver cabeçalho
// de occurrenceSelection.ts): nas 3 h finais do dia local a vista (current_date
// em UTC) esconde o evento pontual do próprio dia que o engine ainda considera futuro.
import { readFileSync as readSql } from 'node:fs';
describe('occurrenceSelection — contrato com a vista active_activities', () => {
  const viewShows = (stored: Date, now: Date) =>
    stored.toISOString().slice(0, 10) >= now.toISOString().slice(0, 10); // start_date >= current_date (UTC)

  it('o predicado reproduzido é o da vista', () => {
    const sql = readSql(new URL('../../../db/migrations/0000_app_baseline.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/recurrence_type = 'none' and start_date >= current_date/);
  });

  it('até às 21:00 locais: engine e vista concordam (evento às 23:00 locais visível)', () => {
    const ev: ActivityOccurrence = { date: '2026-12-24', time: '23:00', endDate: null, endTime: null };
    const now = new Date('2026-12-24T23:59:00Z'); // 20:59 locais
    expect(selectNextOccurrence([ev], now)).toEqual(ev);
    expect(viewShows(toRange(ev).startDate, now)).toBe(true);
  });

  it('LIMITAÇÃO: das 21:00 às 24:00 locais o engine considera futuro mas a vista já não mostra', () => {
    const ev: ActivityOccurrence = { date: '2026-12-24', time: '23:00', endDate: null, endTime: null };
    const now = new Date('2026-12-25T01:00:00Z'); // 22:00 locais
    expect(selectNextOccurrence([ev], now)).toEqual(ev);
    expect(viewShows(toRange(ev).startDate, now)).toBe(false); // corrige-se só com migration da vista
  });
});
