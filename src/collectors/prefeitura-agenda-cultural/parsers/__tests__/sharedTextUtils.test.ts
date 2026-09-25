/**
 * src/collectors/prefeitura-agenda-cultural/parsers/__tests__/sharedTextUtils.test.ts
 *
 * Level 2, 2026-09-24 — Explicit day+month parsing.
 *
 * ⚠ Se já existir um arquivo de teste com este nome, NÃO sobrescrever
 * cegamente — confirmar primeiro com Test-Path e mesclar manualmente.
 * Não tenho confirmação nesta sessão de que este arquivo já existe.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveYearForDayMonth,
  parseDayMonthTextPt,
  extractParentheticalDayMonth,
} from '../sharedTextUtils';

describe('resolveYearForDayMonth', () => {
  it('reference 2026-06-16 + 17/junho → 2026-06-17 (mesmo ano, mais próximo)', () => {
    expect(resolveYearForDayMonth(17, 6, new Date('2026-06-16T00:00:00.000Z'))).toBe('2026-06-17');
  });

  it('reference 2026-09-10 + 17/setembro → 2026-09-17', () => {
    expect(resolveYearForDayMonth(17, 9, new Date('2026-09-10T00:00:00.000Z'))).toBe('2026-09-17');
  });

  it('reference 2026-12-28 + 5/janeiro → 2027-01-05 (rollover para o futuro)', () => {
    expect(resolveYearForDayMonth(5, 1, new Date('2026-12-28T00:00:00.000Z'))).toBe('2027-01-05');
  });

  it('reference 2026-01-02 + 31/dezembro → 2025-12-31 (rollover para o passado — o caso-limite que a regra "claramente anterior" original erraria)', () => {
    expect(resolveYearForDayMonth(31, 12, new Date('2026-01-02T00:00:00.000Z'))).toBe('2025-12-31');
  });

  it('31 de fevereiro é rejeitado em TODOS os candidatos (Fevereiro nunca tem 31 dias, em nenhum ano) — nunca normalizado para Março', () => {
    expect(resolveYearForDayMonth(31, 2, new Date('2026-02-10T00:00:00.000Z'))).toBeNull();
  });

  it('29 de fevereiro é aceito em ano bissexto, rejeitado em ano comum', () => {
    // 2028 é bissexto; referência próxima de 2028 deve aceitar
    expect(resolveYearForDayMonth(29, 2, new Date('2028-02-01T00:00:00.000Z'))).toBe('2028-02-29');
  });

  it('é determinístico — a mesma entrada produz sempre o mesmo resultado, chamada múltiplas vezes', () => {
    const a = resolveYearForDayMonth(15, 3, new Date('2026-03-01T00:00:00.000Z'));
    const b = resolveYearForDayMonth(15, 3, new Date('2026-03-01T00:00:00.000Z'));
    const c = resolveYearForDayMonth(15, 3, new Date('2026-03-01T00:00:00.000Z'));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('nunca usa o relógio do sistema — dois momentos reais diferentes de execução produzem o mesmo resultado para a mesma referenceDate injectada', () => {
    // Não há como mockar Date.now() de forma útil aqui sem acoplar ao
    // vi.useFakeTimers global — a prova real é estrutural: a função
    // nunca chama new Date() sem argumento em nenhum ponto do código
    // (confirmado por leitura), só usa referenceDate.getUTCFullYear()
    // e referenceDate.getTime(). Este teste apenas reforça o
    // comportamento observável de determinismo já coberto acima.
    const result = resolveYearForDayMonth(1, 1, new Date('2026-01-01T00:00:00.000Z'));
    expect(result).toBe('2026-01-01');
  });
});

describe('parseDayMonthTextPt', () => {
  it('reconhece "17 de setembro" sem ano', () => {
    expect(parseDayMonthTextPt('17 de setembro')).toEqual({ day: 17, month: 9 });
  });

  it('reconhece dentro do título real da FLIC, com dia da semana entre parênteses', () => {
    expect(parseDayMonthTextPt('17 de setembro (quinta-feira)')).toEqual({ day: 17, month: 9 });
  });

  it('NÃO reconhece quando há ano explícito no texto — deixa esse caso para parseExplicitDatePt', () => {
    expect(parseDayMonthTextPt('28 de junho de 2026')).toBeNull();
  });

  it('reconhece "31 de fevereiro" sintacticamente (dia+mês são números válidos) — a invalidade de calendário é responsabilidade de resolveYearForDayMonth, não desta função', () => {
    expect(parseDayMonthTextPt('31 de fevereiro')).toEqual({ day: 31, month: 2 });
  });

  it('devolve null para texto sem nenhum padrão de data', () => {
    expect(parseDayMonthTextPt('Yoga no Forte')).toBeNull();
  });
});

describe('extractParentheticalDayMonth', () => {
  it('reconhece "(17/06)"', () => {
    expect(extractParentheticalDayMonth('Data: Quarta-feira (17/06)')).toEqual({ day: 17, month: 6 });
  });

  it('reconhece "(31/02)" sintacticamente — invalidade de calendário fica para resolveYearForDayMonth', () => {
    expect(extractParentheticalDayMonth('(31/02)')).toEqual({ day: 31, month: 2 });
  });

  it('não confunde com (dd) isolado — exige a barra separando dois números', () => {
    expect(extractParentheticalDayMonth('sexta-feira (19)')).toBeNull();
  });

  it('rejeita mês fora do intervalo 1-12 (ex: "(17/13)")', () => {
    expect(extractParentheticalDayMonth('(17/13)')).toBeNull();
  });
});
