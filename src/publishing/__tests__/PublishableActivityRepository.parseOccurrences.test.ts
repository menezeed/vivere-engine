/**
 * src/publishing/__tests__/PublishableActivityRepository.parseOccurrences.test.ts
 * Sprint 8.7 — testa o parser tolerante isoladamente (bug de persistência,
 * ADR-0020, secção "Bug de persistência relacionado").
 */

import { describe, it, expect } from 'vitest';
import { parseOccurrences } from '../repositories/impl/PublishableActivityRepository.js';

describe('parseOccurrences — array jsonb nativo (forma correcta, pós-fix do Collector)', () => {
  it('aceita um array já nativo, sem necessidade de parse', () => {
    const input = [{ date: '2026-08-01', time: '09:00', end_date: null, end_time: null }];
    const result = parseOccurrences(input);

    expect(result).toEqual([{ date: '2026-08-01', time: '09:00', endDate: null, endTime: null }]);
  });

  it('aceita múltiplas ocorrências no array nativo', () => {
    const input = [
      { date: '2026-08-01', time: '09:00', end_date: null, end_time: null },
      { date: '2026-09-15', time: null, end_date: '2026-09-15', end_time: '18:00' },
    ];
    const result = parseOccurrences(input);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ date: '2026-09-15', time: null, endDate: '2026-09-15', endTime: '18:00' });
  });

  it('aceita array vazio', () => {
    expect(parseOccurrences([])).toEqual([]);
  });
});

describe('parseOccurrences — string JSON legada (bug de persistência)', () => {
  it('faz parse de uma string JSON serializada (forma real encontrada em produção)', () => {
    const input = '[{"date":"2026-07-30","time":null,"end_date":null,"end_time":null}]';
    const result = parseOccurrences(input);

    expect(result).toEqual([{ date: '2026-07-30', time: null, endDate: null, endTime: null }]);
  });

  it('faz parse de string legada com múltiplas ocorrências', () => {
    const input = '[{"date":"2026-06-26","time":"16:00","end_date":null,"end_time":null},{"date":"2026-06-28","time":"07:00","end_date":null,"end_time":"08:00"}]';
    const result = parseOccurrences(input);

    expect(result).toHaveLength(2);
    expect(result[0]!.time).toBe('16:00');
    expect(result[1]!.endTime).toBe('08:00');
  });

  it('string JSON de array vazio é válida', () => {
    expect(parseOccurrences('[]')).toEqual([]);
  });
});

describe('parseOccurrences — entradas inválidas: erro explícito, nunca silencioso', () => {
  it('string que não é JSON válido lança erro', () => {
    expect(() => parseOccurrences('não é json')).toThrow(/JSON válido/);
  });

  it('valor que não é array nem string lança erro', () => {
    expect(() => parseOccurrences({ date: '2026-08-01' })).toThrow(/esperado array/);
    expect(() => parseOccurrences(42)).toThrow(/esperado array/);
    expect(() => parseOccurrences(null)).toThrow(/esperado array/);
  });

  it('string JSON que faz parse para algo que não é array lança erro', () => {
    expect(() => parseOccurrences('{"date":"2026-08-01"}')).toThrow(/esperado array/);
  });

  it('elemento do array que não é objecto lança erro identificando o índice', () => {
    expect(() => parseOccurrences(['not-an-object'])).toThrow(/occurrences\[0\]/);
  });

  it('elemento sem campo date (ou com date não-string) lança erro identificando o índice', () => {
    expect(() => parseOccurrences([{ time: '09:00' }])).toThrow(/occurrences\[0\]\.date/);
    expect(() => parseOccurrences([{ date: 123 }])).toThrow(/occurrences\[0\]\.date/);
  });

  it('erro identifica correctamente o índice de um elemento inválido no meio do array', () => {
    const input = [
      { date: '2026-08-01', time: null, end_date: null, end_time: null },
      { time: '10:00' }, // sem date — inválido
    ];
    expect(() => parseOccurrences(input)).toThrow(/occurrences\[1\]\.date/);
  });

  it('nunca devolve [] silenciosamente para entrada inválida — sempre lança', () => {
    expect(() => parseOccurrences(undefined)).toThrow();
    expect(() => parseOccurrences('null')).toThrow(); // JSON.parse('null') = null, não é array
  });
});

describe('parseOccurrences — campos opcionais', () => {
  it('time/end_date/end_time ausentes tornam-se null (não undefined)', () => {
    const result = parseOccurrences([{ date: '2026-08-01' }]);
    expect(result[0]).toEqual({ date: '2026-08-01', time: null, endDate: null, endTime: null });
  });

  it('campos com tipo errado (não string) são tratados como ausentes → null, sem lançar', () => {
    const result = parseOccurrences([{ date: '2026-08-01', time: 123, end_date: false }]);
    expect(result[0]).toEqual({ date: '2026-08-01', time: null, endDate: null, endTime: null });
  });
});
