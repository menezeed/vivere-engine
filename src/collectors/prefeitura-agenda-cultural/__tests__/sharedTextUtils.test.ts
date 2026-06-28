import { describe, it, expect } from 'vitest';
import {
  parseExplicitDatePt,
  parseTimePt,
  parseTimeRangePt,
  combineDayWithReference,
  extractParentheticalDayNumber,
  stripHtmlToText,
} from '../parsers/sharedTextUtils';

describe('parseExplicitDatePt', () => {
  it('converte "28 de junho de 2026" para formato ISO', () => {
    expect(parseExplicitDatePt('Dia: 28 de junho de 2026')).toBe('2026-06-28');
  });

  it('lida com mês acentuado (março)', () => {
    expect(parseExplicitDatePt('15 de março de 2026')).toBe('2026-03-15');
  });

  it('retorna null quando não há data explícita no texto', () => {
    expect(parseExplicitDatePt('texto sem nenhuma data')).toBeNull();
  });
});

describe('parseTimePt', () => {
  it('converte "7h" para "07:00"', () => {
    expect(parseTimePt('7h')).toBe('07:00');
  });

  it('converte "19h30" para "19:30"', () => {
    expect(parseTimePt('19h30')).toBe('19:30');
  });

  it('retorna null para hora inválida (25h)', () => {
    expect(parseTimePt('25h')).toBeNull();
  });

  it('retorna null quando não há horário no texto', () => {
    expect(parseTimePt('sem horário aqui')).toBeNull();
  });
});

describe('parseTimeRangePt — caso real do post "Yoga no Forte" que revelou bug de regex', () => {
  it('extrai range quando precedido por rótulo "Horário:" sem a palavra "das"', () => {
    // Este é o caso exato do dado real coletado: "Horário: 7h às 8h".
    // Versão inicial do regex exigia "das"/"de" antes do primeiro horário
    // e falhava aqui, retornando { time: '08:00', endTime: null } —
    // capturando o horário FINAL como se fosse único. Este teste
    // documenta a correção e previne regressão.
    expect(parseTimeRangePt('Horário: 7h às 8h')).toEqual({ time: '07:00', endTime: '08:00' });
  });

  it('extrai range no formato "das X às Y"', () => {
    expect(parseTimeRangePt('das 7h às 8h')).toEqual({ time: '07:00', endTime: '08:00' });
  });

  it('extrai range com minutos no horário final', () => {
    expect(parseTimeRangePt('das 19h às 20h30')).toEqual({ time: '19:00', endTime: '20:30' });
  });

  it('extrai apenas horário de início em "a partir das 16h"', () => {
    expect(parseTimeRangePt('A partir das 16h')).toEqual({ time: '16:00', endTime: null });
  });

  it('extrai horário único em "o evento começa às 18h"', () => {
    expect(parseTimeRangePt('o evento começa às 18h')).toEqual({ time: '18:00', endTime: null });
  });

  it('retorna ambos null quando não há nenhum horário no texto', () => {
    expect(parseTimeRangePt('sem horário nenhum aqui')).toEqual({ time: null, endTime: null });
  });
});

describe('combineDayWithReference', () => {
  it('combina dia numérico com ano/mês de referência explícitos', () => {
    expect(combineDayWithReference(19, 2026, 6)).toBe('2026-06-19');
  });

  it('preenche com zero à esquerda quando necessário', () => {
    expect(combineDayWithReference(5, 2026, 1)).toBe('2026-01-05');
  });
});

describe('extractParentheticalDayNumber', () => {
  it('extrai o primeiro dia entre parênteses após nome de dia da semana', () => {
    expect(extractParentheticalDayNumber('Nesta sexta-feira (19) e no sábado (20)')).toBe(19);
  });

  it('retorna null quando não há padrão de dia da semana com parênteses', () => {
    expect(extractParentheticalDayNumber('texto qualquer sem esse padrão')).toBeNull();
  });
});

describe('stripHtmlToText — caso real do post "Yoga no Forte"', () => {
  it('remove tags e preserva quebras de linha legíveis a partir de <br> e </p>', () => {
    const html =
      '<p>Texto inicial.</p>\n\n\n\n<p><strong>SERVIÇO:</strong></p>\n\n\n\n' +
      '<p><strong>Yoga no Forte – Edição de junho</strong><br>Dia: 28 de junho de 2026<br>Horário: 7h às 8h<br>Local: Canto do Forte</p>';

    const result = stripHtmlToText(html);

    expect(result).toContain('SERVIÇO:');
    expect(result).toContain('Dia: 28 de junho de 2026');
    expect(result).toContain('Horário: 7h às 8h');
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('<strong>');
  });

  it('decodifica entidades HTML comuns (en-dash, aspas tipográficas)', () => {
    const html = '<p>Edi&#8231;&#8217;&#8217;o &#8211; junho &#8220;teste&#8221;</p>';
    const result = stripHtmlToText(html);
    expect(result).toContain('–');
    expect(result).toContain('\u201c');
  });
});
