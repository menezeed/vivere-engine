import { describe, it, expect } from 'vitest';
import { parseNarrativeFallback, NARRATIVE_CONFIDENCE } from '../parsers/narrativeFallbackParser';

describe('parseNarrativeFallback — ambiguidade (caso real "Forte São Mateus")', () => {
  const html =
    '<p>Nesta sexta-feira (19) e no sábado (20), o Forte São Mateus recebe mais uma edição ' +
    'do evento musical "O Canto do Forte". A partir das 16h, moradores e visitantes poderão ' +
    'apreciar o pôr do sol ao som de boa música.</p>';

  it('marca como ambíguo quando há múltiplas datas candidatas, em vez de escolher uma', () => {
    const result = parseNarrativeFallback(html, { year: 2026, month: 6 });
    expect(result.status).toBe('ambiguous');
    expect(result.date).toBeNull();
  });

  it('preserva todas as datas candidatas encontradas, mesmo sem decidir qual usar', () => {
    const result = parseNarrativeFallback(html, { year: 2026, month: 6 });
    expect(result.candidateDates).toEqual([
      { date: '2026-06-19', matchedText: 'sexta-feira (19)' },
      { date: '2026-06-20', matchedText: 'sábado (20)' },
    ]);
  });

  it('nunca atribui confidence a um resultado ambíguo', () => {
    expect(parseNarrativeFallback(html, { year: 2026, month: 6 }).confidence).toBeNull();
  });
});

describe('parseNarrativeFallback — caminho de sucesso (1 data clara, 1 horário claro)', () => {
  const html =
    '<p>Neste domingo (28) acontece uma apresentação especial no Centro Cultural. ' +
    'A partir das 19h, o público poderá acompanhar o show gratuitamente.</p>';

  it('extrai data, horário e venue quando há exatamente 1 candidato de cada', () => {
    const result = parseNarrativeFallback(html, { year: 2026, month: 6 });
    expect(result.status).toBe('extracted');
    expect(result.date).toBe('2026-06-28');
    expect(result.time).toBe('19:00');
    expect(result.venueName).toBe('Centro Cultural');
  });

  it('usa confidence SINGLE_CLEAR quando data e horário foram extraídos com sucesso', () => {
    expect(parseNarrativeFallback(html, { year: 2026, month: 6 }).confidence).toBe(NARRATIVE_CONFIDENCE.SINGLE_CLEAR);
  });
});

describe('parseNarrativeFallback — extração parcial sinalizada (data ok, venue não encontrado)', () => {
  it('marca review_reason venue_not_extracted_from_narrative sem descartar data/hora já extraídos', () => {
    const html = '<p>Nesta quinta-feira (10), a partir das 18h, acontece uma roda de samba para os moradores.</p>';
    const result = parseNarrativeFallback(html, { year: 2026, month: 7 });

    expect(result.status).toBe('extracted');
    expect(result.date).toBe('2026-07-10');
    expect(result.time).toBe('18:00');
    expect(result.venueName).toBeNull();
    expect(result.reviewReasons).toContain('venue_not_extracted_from_narrative');
  });
});

describe('parseNarrativeFallback — nenhum sinal de data', () => {
  it('retorna not_found quando o texto não contém nenhuma data candidata', () => {
    const html = '<p>A Secretaria de Cultura anuncia novo edital de fomento para artistas locais.</p>';
    const result = parseNarrativeFallback(html, { year: 2026, month: 6 });
    expect(result.status).toBe('not_found');
  });
});
