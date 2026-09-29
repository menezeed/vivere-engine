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

// Activity 13/26, F6, 2026-09-28 — Pure Recurrence Narrative Discovery
// Gap. Quando não há data concreta, mas há evidência forte e
// determinística de recorrência (reutilizada de detectRecurrence.ts,
// nunca reimplementada aqui), o resultado passa a ser 'recurrence_only'
// em vez de 'not_found'.
describe('parseNarrativeFallback — Activity 13 F6 (recurrence-only, sem data concreta)', () => {
  it('1. POSITIVO real — "Toda sexta-feira... das 10h às 15h" (Feira, São Pedro da Aldeia) → recurrence_only', () => {
    const html =
      '<p>Toda sexta-feira, cães e gatos resgatados encontram um lar definitivo em São Pedro da Aldeia. ' +
      'A Feira de Adoção da ONG UZCA acontece das 10h às 15h, no estacionamento da American Pet, ' +
      'às margens da Rodovia RJ-140, com apoio da Prefeitura.</p>';

    const result = parseNarrativeFallback(html, { year: 2026, month: 9 });

    expect(result.status).toBe('recurrence_only');
    expect(result.date).toBeNull();
    expect(result.time).toBeNull(); // recurrence_time é calculado depois, por detectRecurrence — nunca aqui
    expect(result.confidence).toBe(NARRATIVE_CONFIDENCE.RECURRENCE_ONLY);
    expect(result.candidateDates).toEqual([]);
  });

  it('2. NEGATIVO real — PNAB: "nesta sexta-feira (25/09)" + "até as 17h" (não relacionados) → not_found, nunca recurrence_only', () => {
    const html =
      '<p>A Secretaria Municipal de Cultura divulgou, nesta sexta-feira (25/09), o resultado final do ' +
      'primeiro ciclo de habilitação. As dúvidas devem ser encaminhadas até as 17h, no horário de Brasília.</p>';

    const result = parseNarrativeFallback(html, { year: 2026, month: 9 });

    // "sexta-feira (25/09)" tem barra — não corresponde ao padrão de data
    // candidata (dd) sem barra, então nunca chega a existir uma data
    // candidata aqui; cai directamente no ramo novo (F6), que corretamente
    // rejeita por falta de evidência forte de recorrência (dia e horário
    // em frases não relacionadas) — resultado final: not_found, nunca
    // recurrence_only. Confirma que F6 não introduz um falso positivo
    // onde antes (Activity 8/9/10B) já não havia nenhum.
    expect(result.status).toBe('not_found');
  });

  it('3. NEGATIVO — apenas dia da semana, sem nenhuma evidência forte de recorrência → not_found', () => {
    const html = '<p>O evento acontece sexta-feira, no centro da cidade.</p>';
    const result = parseNarrativeFallback(html, { year: 2026, month: 9 });

    expect(result.status).toBe('not_found');
  });

  it('4. NEGATIVO — apenas horário, sem nenhum dia da semana → not_found', () => {
    const html = '<p>O evento acontece às 10h, no centro da cidade.</p>';
    const result = parseNarrativeFallback(html, { year: 2026, month: 9 });

    expect(result.status).toBe('not_found');
  });

  it('5. NEGATIVO — mensal-ordinal não suportado ("todo último domingo de cada mês") → nunca vira recurrence_only', () => {
    const html = '<p>As aulas acontecem todo último domingo de cada mês, no Teatro Municipal.</p>';
    const result = parseNarrativeFallback(html, { year: 2026, month: 9 });

    expect(result.status).toBe('not_found');
  });

  it('6. regressão — narrativa com data concreta válida continua pelo caminho "extracted" existente, inalterado', () => {
    const html =
      '<p>Neste domingo (28) acontece uma apresentação especial no Centro Cultural. ' +
      'A partir das 19h, o público poderá acompanhar o show gratuitamente.</p>';
    const result = parseNarrativeFallback(html, { year: 2026, month: 6 });

    expect(result.status).toBe('extracted');
    expect(result.date).toBe('2026-06-28');
  });

  it('7. venue ausente em recurrence_only também sinaliza review_reason (mesmo padrão do caminho "extracted")', () => {
    const html = '<p>Toda sexta-feira, das 10h às 15h, acontece a atividade.</p>';
    const result = parseNarrativeFallback(html, { year: 2026, month: 9 });

    expect(result.status).toBe('recurrence_only');
    expect(result.venueName).toBeNull();
    expect(result.reviewReasons).toContain('venue_not_extracted_from_narrative');
  });
});
