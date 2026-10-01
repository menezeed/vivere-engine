/**
 * src/pipeline/stages/02-recurrence-detection/__tests__/detectRecurrence.test.ts
 *
 * Activity 8/26, 2026-09-26. Cobertura dos casos A-K aprovados.
 */

import { describe, it, expect } from 'vitest';
import { detectRecurrence, detectRecurrenceItems, hasQualifyingRecurrenceEvidence } from '../detectRecurrence';
import type { RawActivityItem } from '../../../../types/RawActivityItem';

function makeItem(overrides: Partial<RawActivityItem> = {}): RawActivityItem {
  return {
    source_key: 'test_source',
    source_item_id: '1_0',
    collected_at: new Date().toISOString(),
    title: 'Actividade de teste',
    description: null,
    raw_category_text: null,
    occurrences: [],
    recurrence_text_hint: null,
    venue_mention: null,
    price_text: null,
    is_free_hint: null,
    image_url: null,
    external_url: null,
    contact_phone: null,
    contact_email: null,
    language: 'pt',
    raw_payload: {},
    ...overrides,
  };
}

describe('detectRecurrence — padrões reais confirmados', () => {
  it('A. "toda sexta-feira" → weekly / [5] / sem horário', () => {
    const item = makeItem({ title: 'Yoga', description: 'toda sexta-feira' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([5]);
    expect(result.recurrence.recurrence_time).toBeNull();
    expect(result.recurrence.review_reasons).toEqual([]);
    expect(result.item.recurrence_text_hint).toBe('toda sexta-feira');
  });

  it('B. "Todas as sextas-feiras, das 10h às 15h" → weekly / [5] / 10:00, hint verbatim, end-time sinalizado', () => {
    const item = makeItem({
      title: 'Dança',
      description: 'Todas as sextas-feiras, das 10h às 15h',
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([5]);
    expect(result.recurrence.recurrence_time).toBe('10:00');
    expect(result.recurrence.review_reasons).toEqual(['recurrence_end_time_not_persisted']);
    // Evidência verbatim — o "15h" nunca é perdido, fica recuperável aqui:
    expect(result.item.recurrence_text_hint).toBe('Todas as sextas-feiras, das 10h às 15h');
    expect(result.item.recurrence_text_hint).toContain('15h');
  });

  it('C. "Quartas e sextas das 9h às 11h" → weekly / [3,5] / 09:00, end-time sinalizado', () => {
    const item = makeItem({
      title: 'Oficina de Teatro para Idosos',
      description: 'Quartas e sextas das 9h às 11h',
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([3, 5]);
    expect(result.recurrence.recurrence_time).toBe('09:00');
    expect(result.recurrence.review_reasons).toEqual(['recurrence_end_time_not_persisted']);
    expect(result.item.recurrence_text_hint).toContain('11h');
  });

  it('D. "Terças das 14h às 16h15 e sextas das 9h às 11h" → weekly / [2,5] / NULL (nunca 14:00 nem 09:00 arbitrário), per-day gap sinalizado', () => {
    const item = makeItem({
      title: 'Oficina de Moda e Costura para Idosos',
      description: 'Terças das 14h às 16h15 e sextas das 9h às 11h',
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([2, 5]);
    expect(result.recurrence.recurrence_time).toBeNull();
    expect(result.recurrence.review_reasons).toEqual(['recurrence_per_day_times_not_representable']);
    // Nada escolhido arbitrariamente entre 14:00 e 09:00 — ambos ficam
    // recuperáveis, verbatim, no hint:
    expect(result.item.recurrence_text_hint).toContain('14h');
    expect(result.item.recurrence_text_hint).toContain('9h');
  });

  it('E. recurrence + ocorrência concreta — ambas preservadas, uma não substitui a outra', () => {
    const item = makeItem({
      title: 'Feira semanal',
      description: 'toda sexta-feira',
      occurrences: [{ date: '2026-05-01', time: null, end_date: null, end_time: null }],
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([5]);
    // occurrences[] nunca é tocado por este estágio:
    expect(result.item.occurrences).toEqual([{ date: '2026-05-01', time: null, end_date: null, end_time: null }]);
  });

  it('F. Yoga / single event — inalterado, recurrence_type/days/time NULL, sem mutação', () => {
    const item = makeItem({
      title: 'Yoga no Forte – Edição de setembro',
      description: null,
      occurrences: [{ date: '2026-09-27', time: '07:00', end_date: null, end_time: '08:00' }],
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
    expect(result.recurrence.recurrence_days).toBeNull();
    expect(result.recurrence.recurrence_time).toBeNull();
    expect(result.recurrence.review_reasons).toEqual([]);
    expect(result.item.recurrence_text_hint).toBeNull();
    expect(result.item.occurrences).toEqual(item.occurrences);
  });

  it('G. texto sem recurrence → nenhum falso positivo', () => {
    const item = makeItem({ title: 'Palestra sobre saúde', description: 'Evento único, inscrições abertas na secretaria' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
    expect(result.item.recurrence_text_hint).toBeNull();
  });

  it('H. linguagem editorial próxima de recorrência, sem sinal genuíno suficiente — NÃO produz falso positivo', () => {
    // Achado real desta Activity: sem esta protecção, "sexta-feira"
    // sozinho em texto noticioso seria indevidamente marcado como
    // recorrência semanal. Corrigido: só considera recorrência quando
    // há, adicionalmente, "todo/toda/todos/todas" ou um intervalo de
    // horário — ambos presentes em todos os 4 padrões reais (A-D),
    // ausentes aqui.
    const item = makeItem({
      title: 'Prefeitura divulga resultado da eleição de sexta-feira',
      description: null,
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
    expect(result.recurrence.recurrence_days).toBeNull();
    expect(result.item.recurrence_text_hint).toBeNull();
  });

  it('I. detector NUNCA muta o RawActivityItem original', () => {
    const item = makeItem({ title: 'Zumba', description: 'toda sexta-feira' });
    const originalRef = item;
    const result = detectRecurrence(item);

    expect(item).toBe(originalRef); // objecto de entrada, intocado
    expect(item.recurrence_text_hint).toBeNull(); // original nunca ganha o campo
    expect(result.item).not.toBe(item); // resultado é um objecto novo
    expect(result.item.recurrence_text_hint).toBe('toda sexta-feira');
  });

  it('sem detecção: item devolvido é a MESMA referência (nenhum objecto novo desnecessário)', () => {
    const item = makeItem({ title: 'Palestra única' });
    const result = detectRecurrence(item);

    expect(result.item).toBe(item);
  });

  it('detectRecurrenceItems aplica a uma lista, preservando a ordem', () => {
    const items = [
      makeItem({ source_item_id: '1', title: 'Yoga' }),
      makeItem({ source_item_id: '2', title: 'Zumba', description: 'toda sexta-feira' }),
    ];
    const results = detectRecurrenceItems(items);

    expect(results).toHaveLength(2);
    expect(results[0]!.item.source_item_id).toBe('1');
    expect(results[0]!.recurrence.recurrence_type).toBeNull();
    expect(results[1]!.item.source_item_id).toBe('2');
    expect(results[1]!.recurrence.recurrence_type).toBe('weekly');
  });

  // Activity 10B, 2026-09-27 — teste de regressão para o bug real de
  // lastIndex (regex global reutilizada entre .test()/.matchAll()),
  // confirmado por execução durante esta Activity: chamar
  // detectRecurrenceItems repetidamente sobre o MESMO array tem de
  // produzir sempre o mesmo resultado — nunca alternar por causa de
  // estado de regex partilhado entre chamadas.
  it('resultado é estável em chamadas repetidas de detectRecurrenceItems sobre o mesmo lote (regressão lastIndex)', () => {
    const items = [
      makeItem({ source_item_id: '1', description: 'toda sexta-feira' }),
      makeItem({ source_item_id: '2', description: 'Quartas e sextas das 9h às 11h' }),
      makeItem({ source_item_id: '3', description: 'terças, às 9h, e quintas, às 17h' }),
    ];

    const first = detectRecurrenceItems(items);
    for (let i = 0; i < 5; i++) {
      const again = detectRecurrenceItems(items);
      expect(again.map((r) => r.recurrence)).toEqual(first.map((r) => r.recurrence));
    }
  });
});

// Activity 10B, 2026-09-27 — Recurrence Discovery Hardening.
describe('detectRecurrence — Activity 10B Part 1 (extracção de horário único)', () => {
  it('A. "toda quinta-feira, às 17h" → weekly/[4]/17:00, sem perda, sem review_reason', () => {
    const item = makeItem({ title: 'Coral', description: 'A oficina de coral acontece toda quinta-feira, às 17h.' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([4]);
    expect(result.recurrence.recurrence_time).toBe('17:00');
    expect(result.recurrence.review_reasons).toEqual([]);
  });

  it('B. intervalo completo continua a funcionar como antes (regressão)', () => {
    const item = makeItem({ description: 'Todas as sextas-feiras, das 10h às 15h' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_time).toBe('10:00');
    expect(result.recurrence.review_reasons).toEqual(['recurrence_end_time_not_persisted']);
  });

  it('C. dois horários únicos distintos por dia → recurrence_time NULL, per-day-gap, nunca escolhido arbitrariamente', () => {
    const item = makeItem({ description: 'terças, às 9h, e quintas, às 17h' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([2, 4]);
    expect(result.recurrence.recurrence_time).toBeNull();
    expect(result.recurrence.review_reasons).toEqual(['recurrence_per_day_times_not_representable']);
  });

  it('dois intervalos completos distintos → comportamento inalterado (regressão, Activity 8 Caso D)', () => {
    const item = makeItem({ description: 'Terças das 14h às 16h15 e sextas das 9h às 11h' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_time).toBeNull();
    expect(result.recurrence.review_reasons).toEqual(['recurrence_per_day_times_not_representable']);
  });

  it('sem nenhuma menção de horário → NULL, sem review_reason (regressão, Activity 8 Caso A)', () => {
    const item = makeItem({ description: 'toda sexta-feira' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_time).toBeNull();
    expect(result.recurrence.review_reasons).toEqual([]);
  });
});

describe('detectRecurrence — Activity 10B Part 2 (guarda mensal-ordinal)', () => {
  it('D. "todo último domingo de cada mês" → NÃO weekly, recurrence estruturada null, review_reason ordinal', () => {
    const item = makeItem({ description: 'As aulas acontecem todo último domingo de cada mês.' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
    expect(result.recurrence.recurrence_days).toBeNull();
    expect(result.recurrence.recurrence_time).toBeNull();
    expect(result.recurrence.review_reasons).toEqual(['recurrence_ordinal_month_not_representable']);
    // Evidência preservada, verbatim, mesmo sem recorrência estruturada:
    expect(result.item.recurrence_text_hint).toContain('último domingo de cada mês');
  });

  it('E. "todo domingo" simples continua weekly/[0] — a guarda não é demasiado agressiva (regressão)', () => {
    const item = makeItem({ description: 'todo domingo' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([0]);
    expect(result.recurrence.review_reasons).toEqual([]);
  });

  it('guarda dispara para "todo primeiro sábado do mês" (variante ordinal diferente, com sinal "todo")', () => {
    const item = makeItem({ description: 'A reunião acontece todo primeiro sábado do mês.' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
    expect(result.recurrence.review_reasons).toEqual(['recurrence_ordinal_month_not_representable']);
  });

  it('I. protecção de falso positivo editorial permanece PASS (regressão, Activity 8)', () => {
    const item = makeItem({ title: 'Prefeitura divulga resultado da eleição de sexta-feira' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
    expect(result.item.recurrence_text_hint).toBeNull();
  });

  it('J. recorrência semanal já suportada permanece PASS (regressão, Activity 8/9)', () => {
    const item = makeItem({ description: 'Quartas e sextas das 9h às 11h' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([3, 5]);
  });
});

describe('detectRecurrence — Activity 10B Part 4 (contexto adicional: raw_payload.raw_text / article_context_text)', () => {
  it('F. article_context_text disponível (evento único) é consumido pelo detector', () => {
    const item = makeItem({
      title: 'Yoga no Forte – Edição de setembro',
      description: null,
      raw_payload: {
        extraction_method: 'structured_block',
        raw_text: 'Yoga no Forte – Edição de setembro\nDia: 27 de setembro de 2026 (domingo)\nHorário: 7h às 8h',
        article_context_text: 'As aulas acontecem todo último domingo de cada mês.',
      },
    });
    const result = detectRecurrence(item);

    // A guarda ordinal (Part 2) dispara, porque o contexto chegou ao detector:
    expect(result.recurrence.review_reasons).toEqual(['recurrence_ordinal_month_not_representable']);
    expect(result.item.recurrence_text_hint).toContain('todo último domingo de cada mês');
  });

  it('G. article_context_text AUSENTE (multi-evento, invariante de segurança) — contexto nunca chega ao detector', () => {
    // Simula o comportamento correcto do Collector para >1 sub-evento:
    // article_context_text nunca é populado — o mesmo texto que existiria
    // no artigo original simplesmente não está aqui, tal como o Collector
    // garante (ver mapToRawActivityItems.ts, Activity 10B Part 3).
    const item = makeItem({
      title: '17 de setembro (quinta-feira)',
      description: null,
      raw_payload: {
        extraction_method: 'structured_block',
        raw_text: '17 de setembro (quinta-feira)\n\n14h — Abertura Oficial',
        // sem article_context_text — invariante do Collector
      },
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
    expect(result.recurrence.review_reasons).toEqual([]);
  });

  it('H. narrative_fallback: raw_payload.raw_text (artigo completo, já preservado desde a Activity 8) é consumido sem repropor description', () => {
    const item = makeItem({
      title: 'Coral para idosos',
      description: null,
      raw_payload: {
        extraction_method: 'narrative_fallback',
        raw_text: 'A oficina de coral para idosos acontece toda quinta-feira, às 17h, no Teatro Municipal.',
      },
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([4]);
    expect(result.recurrence.recurrence_time).toBe('17:00');
    // description nunca é tocado/reinterpretado — continua null no item original:
    expect(item.description).toBeNull();
  });

  it('K. narrative_fallback SEM recorrência genuína continua sem detecção (regressão, Pre-Flight 1.3)', () => {
    const item = makeItem({
      title: 'Mostra coletiva',
      description: null,
      raw_payload: {
        extraction_method: 'narrative_fallback',
        raw_text: 'A partir desta quinta-feira, o Forte São Mateus recebe novos artistas para a mostra coletiva.',
      },
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
  });
});

// Activity 13/26, 2026-09-27 — F5, Fix 2 (guarda de referência datada).
describe('detectRecurrence — Activity 13 F5 (guarda de referência datada)', () => {
  it('5. PNAB real: "nesta sexta-feira (25/09)" + "até as 17h" (frase não relacionada) → NÃO produz recorrência falsa', () => {
    const item = makeItem({
      title: 'Cultura divulga resultado final do primeiro ciclo de credenciamento de pareceristas da PNAB',
      description: 'A Secretaria Municipal de Cultura de São Pedro da Aldeia divulgou, nesta sexta-feira (25/09), o resultado final do primeiro ciclo de habilitação. As dúvidas sobre o edital devem ser encaminhadas exclusivamente pelo e-mail, até as 17h, no horário de Brasília.',
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
    expect(result.recurrence.recurrence_days).toBeNull();
    expect(result.recurrence.recurrence_time).toBeNull();
  });

  it('6. regressão — "Todas as sextas-feiras, das 10h às 15h" continua weekly/[5]/10:00 (Activity 8, inalterado)', () => {
    const item = makeItem({ description: 'Todas as sextas-feiras, das 10h às 15h' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([5]);
    expect(result.recurrence.recurrence_time).toBe('10:00');
  });

  it('7. caso real misto — recorrência genuína + edição específica com data entre parênteses SOBREVIVE ao guarda (Activity 8, Caso E)', () => {
    const item = makeItem({
      title: 'Feira semanal de adoção de cães e gatos ganha novidade nesta sexta-feira (01)',
      description: 'A Feira Semanal de Adoção de Cães e Gatos de São Pedro da Aldeia terá uma novidade nesta sexta-feira (01/05). Toda sexta-feira, cães e gatos resgatados encontram um lar. A ação acontece das 10h às 15h.',
    });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([5]);
    expect(result.recurrence.recurrence_time).toBe('10:00');
  });

  it('guarda não dispara para menção de dia isolada sem NENHUM sinal de horário (mesmo com data entre parênteses) — continua sem recorrência, review_reasons vazio', () => {
    const item = makeItem({ title: 'Prefeitura anuncia resultado da eleição nesta sexta-feira (25/09)' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
    expect(result.recurrence.review_reasons).toEqual([]);
  });

  // Fronteira exacta do guarda — 4 casos mínimos.
  it('fronteira A — "sexta-feira (25)" sem barra, + horário não relacionado → mesma semântica de data explícita que com barra', () => {
    const item = makeItem({ description: 'nesta sexta-feira (25), o evento acontece. até as 17h, prazo final.' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
  });

  it('fronteira B — "sexta-feira (25/09)" com barra, + horário não relacionado → sem recorrência', () => {
    const item = makeItem({ description: 'sexta-feira (25/09), o evento acontece. até as 17h, prazo final.' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBeNull();
  });

  it('fronteira C — "toda sexta-feira" + "sexta-feira (25/09)" + horário recorrente → recorrência preservada', () => {
    const item = makeItem({ description: 'toda sexta-feira, sexta-feira (25/09) inclusive, das 10h às 15h.' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([5]);
    expect(result.recurrence.recurrence_time).toBe('10:00');
  });

  it('fronteira D — "todas as sextas-feiras, às 10h" (horário único, sem data entre parênteses) → recorrência preservada', () => {
    const item = makeItem({ description: 'todas as sextas-feiras, às 10h' });
    const result = detectRecurrence(item);

    expect(result.recurrence.recurrence_type).toBe('weekly');
    expect(result.recurrence.recurrence_days).toEqual([5]);
    expect(result.recurrence.recurrence_time).toBe('10:00');
  });
});

// Activity 13/26, F6, 2026-09-28 — hasQualifyingRecurrenceEvidence,
// exportada para reuso por narrativeFallbackParser.ts (Collector).
describe('hasQualifyingRecurrenceEvidence — exportada para reuso (Activity 13, F6)', () => {
  it('verdadeiro para recorrência genuína real (Feira, São Pedro da Aldeia)', () => {
    expect(hasQualifyingRecurrenceEvidence('Toda sexta-feira, cães e gatos encontram lar. Acontece das 10h às 15h.')).toBe(true);
  });

  it('falso para PNAB (dia + horário não relacionados)', () => {
    expect(hasQualifyingRecurrenceEvidence('nesta sexta-feira (25/09), resultado final. até as 17h, prazo.')).toBe(false);
  });

  it('falso para dia sozinho, sem nenhum sinal de horário ou "todo/toda"', () => {
    expect(hasQualifyingRecurrenceEvidence('O evento acontece sexta-feira.')).toBe(false);
  });

  it('falso para horário sozinho, sem nenhum dia da semana', () => {
    expect(hasQualifyingRecurrenceEvidence('O evento acontece às 10h.')).toBe(false);
  });

  it('falso para mensal-ordinal não suportado', () => {
    expect(hasQualifyingRecurrenceEvidence('todo último domingo de cada mês')).toBe(false);
  });
});

// Activity 13/26, F8, 2026-09-29 — correcção de causa raiz: "todo/toda/
// todos/todas" só conta como sinal de recorrência quando estruturalmente
// associado a um dia da semana, nunca como palavra comum em qualquer
// lugar do texto (quantificador português "todos os X", "toda a Y").
describe('detectRecurrence — Activity 13 F8 (sinal todo/toda associado ao dia, não à palavra solta)', () => {
  const PNAB_REAL_FULL_TEXT =
    'A Secretaria Municipal de Cultura de São Pedro da Aldeia divulgou, nesta sexta-feira (25/09), o resultado final do primeiro ciclo de habilitação e a atualização da lista de credenciados do Edital de Chamamento Público nº 04/2026. O processo é destinado ao credenciamento de pareceristas para os editais da Política Nacional Aldir Blanc (PNAB) de Fomento à Cultura. Também foi divulgado o resultado dos recursos. Todos os documentos estão disponíveis na página do edital no Portal da Transparência. Clique aqui para consultar os resultados. Os profissionais habilitados e credenciados integrarão o Banco de Pareceristas da Secretaria Municipal de Cultura. Conforme o edital, o credenciamento gera expectativa de contratação, ficando a convocação condicionada à necessidade da administração municipal, à disponibilidade orçamentária e financeira e à ordem de classificação dos credenciados. O Termo de Referência prevê a distribuição dos trabalhos por rodízio sequencial entre os pareceristas aptos, observadas a ordem de classificação e a disponibilidade para execução dos serviços. As dúvidas sobre o edital devem ser encaminhadas à Comissão de Contratação durante a vigência do chamamento, exclusivamente pelo e-mail editais.cultura@pmspa.rj.gov.br, até as 17h, no horário de Brasília. Sobre o Edital – O Chamamento Público nº 04/2026 prevê o credenciamento de prestadores de serviços para análise técnica, avaliação de mérito cultural e emissão de pareceres conclusivos sobre projetos apresentados aos editais da PNAB. Os serviços atenderão às demandas da Secretaria Municipal de Cultura, conforme as condições e exigências estabelecidas no edital e em seus anexos.';

  it('1. "toda sexta-feira" → sinal de recorrência (regressão, inalterado)', () => {
    const r = detectRecurrence(makeItem({ description: 'toda sexta-feira, das 10h às 15h' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
  });

  it('2. "todas as sextas-feiras" → sinal de recorrência (regressão, inalterado)', () => {
    const r = detectRecurrence(makeItem({ description: 'todas as sextas-feiras, das 10h às 15h' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
  });

  it('3. "todo sábado" → sinal de recorrência (novo positivo)', () => {
    const r = detectRecurrence(makeItem({ description: 'todo sábado, das 9h às 12h' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([6]);
  });

  it('4. "todos os sábados" → sinal de recorrência (novo positivo)', () => {
    const r = detectRecurrence(makeItem({ description: 'todos os sábados, às 9h' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([6]);
  });

  it('5. "Toda sexta-feira, das 10h às 15h" preserva weekly/[5]/10:00 (Feira real)', () => {
    const r = detectRecurrence(makeItem({ description: 'Toda sexta-feira, cães e gatos encontram lar. Acontece das 10h às 15h.' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([5]);
    expect(r.recurrence.recurrence_time).toBe('10:00');
  });

  it('6. PNAB — texto REAL completo (com "Todos os documentos estão disponíveis") → sem recorrência (F8, causa raiz corrigida)', () => {
    const r = detectRecurrence(makeItem({ title: 'Cultura divulga resultado final do primeiro ciclo de credenciamento de pareceristas da PNAB', description: PNAB_REAL_FULL_TEXT }));
    expect(r.recurrence.recurrence_type).toBeNull();
    expect(r.recurrence.recurrence_days).toBeNull();
    expect(r.recurrence.recurrence_time).toBeNull();
  });

  it('7. "Todas as informações estão disponíveis" + dia datado → sem recorrência', () => {
    const r = detectRecurrence(makeItem({ description: 'Todas as informações estão disponíveis. sexta-feira (25/09). até as 17h.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('8. "toda a população" + dia datado → sem recorrência', () => {
    const r = detectRecurrence(makeItem({ description: 'toda a população foi informada. sexta-feira (25/09). até as 17h.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('9. "todo o processo" + dia datado → sem recorrência', () => {
    const r = detectRecurrence(makeItem({ description: 'todo o processo foi concluído. sexta-feira (25/09). até as 17h.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('10. dia sozinho, sem horário nem "todo/toda" → comportamento existente preservado', () => {
    const r = detectRecurrence(makeItem({ description: 'O evento acontece sexta-feira.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('11. horário sozinho, sem dia → comportamento existente preservado', () => {
    const r = detectRecurrence(makeItem({ description: 'O evento acontece às 10h.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('12. mensal-ordinal não suportado → comportamento de segurança preservado', () => {
    const r = detectRecurrence(makeItem({ description: 'As aulas acontecem todo último domingo de cada mês.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
    expect(r.recurrence.review_reasons).toEqual(['recurrence_ordinal_month_not_representable']);
  });

  it('13. "toda sexta-feira" + edição específica "nesta sexta-feira (01)" → recorrência preservada (Activity 8, Caso E)', () => {
    const r = detectRecurrence(makeItem({ description: 'terá uma novidade nesta sexta-feira (01/05). Toda sexta-feira, cães e gatos encontram lar. das 10h às 15h.' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([5]);
    expect(r.recurrence.recurrence_time).toBe('10:00');
  });

  it('14. quantificador comum ("todos os documentos") + "toda sexta-feira" genuína no mesmo texto → recorrência preservada, porque existe evidência genuína independente', () => {
    const r = detectRecurrence(makeItem({ description: 'Todos os documentos estão disponíveis para consulta. Toda sexta-feira, das 10h às 15h, acontece a feira.' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([5]);
    expect(r.recurrence.recurrence_time).toBe('10:00');
  });

  it('F6 compatibilidade — hasQualifyingRecurrenceEvidence ainda qualifica a Feira real após a correcção de F8', () => {
    expect(hasQualifyingRecurrenceEvidence('Toda sexta-feira, cães e gatos encontram lar. Acontece das 10h às 15h.')).toBe(true);
  });
});

// Activity 13/26, F9, 2026-09-29 — correcção de causa raiz: "domingo" e
// "sábado" nunca levam sufixo "-feira" em português — o guarda de "só
// menção datada" exigia esse sufixo sempre, deixando "neste sábado (03)"/
// "neste domingo (13)" passar como se fossem dias "nus", sem data,
// produzindo recorrência semanal falsa a partir de eventos de data única.
describe('detectRecurrence — Activity 13 F9 (domingo/sábado sem sufixo -feira reconhecidos como datados)', () => {
  it('1. "neste sábado (03)" + horário → sem recorrência', () => {
    const r = detectRecurrence(makeItem({ description: 'O evento acontece neste sábado (03), às 19h.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('2. "neste sabado (03)" (sem acento) + horário → sem recorrência', () => {
    const r = detectRecurrence(makeItem({ description: 'O evento acontece neste sabado (03), às 19h.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('3. "neste domingo (13)" + horário → sem recorrência', () => {
    const r = detectRecurrence(makeItem({ description: 'O evento acontece neste domingo (13), às 15h.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('4. "sexta-feira (25)" sem barra + horário não relacionado → supressão preservada (regressão F5)', () => {
    const r = detectRecurrence(makeItem({ description: 'nesta sexta-feira (25), o evento. até as 17h, prazo.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('5. "sexta-feira (25/09)" com barra + horário não relacionado → supressão preservada (regressão F5)', () => {
    const r = detectRecurrence(makeItem({ description: 'sexta-feira (25/09), o evento. até as 17h, prazo.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('6. "todo sábado" → recorrência genuína preservada', () => {
    const r = detectRecurrence(makeItem({ description: 'todo sábado, das 9h às 12h' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([6]);
  });

  it('7. "todos os sábados" → recorrência genuína preservada', () => {
    const r = detectRecurrence(makeItem({ description: 'todos os sábados, às 9h' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([6]);
  });

  it('8. "todo domingo" → recorrência genuína preservada', () => {
    const r = detectRecurrence(makeItem({ description: 'todo domingo, das 9h às 12h' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([0]);
  });

  it('9. "todos os domingos" → recorrência genuína preservada', () => {
    const r = detectRecurrence(makeItem({ description: 'todos os domingos, às 9h' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([0]);
  });

  it('10. "toda sexta-feira" → recorrência genuína preservada (regressão)', () => {
    const r = detectRecurrence(makeItem({ description: 'toda sexta-feira, das 10h às 15h' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
  });

  it('11. "todos os sábados" + "neste sábado (03)" → recorrência preservada (evidência independente)', () => {
    const r = detectRecurrence(makeItem({ description: 'todos os sábados, das 9h às 12h. neste sábado (03) tem edição especial.' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([6]);
  });

  it('12. "todo domingo" + "neste domingo (13)" → recorrência preservada (evidência independente)', () => {
    const r = detectRecurrence(makeItem({ description: 'todo domingo, às 10h. neste domingo (13) tem edição especial.' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([0]);
  });

  it('13. regressão F8 — "Todos os documentos estão disponíveis" + "sexta-feira (25/09)" → sem recorrência', () => {
    const r = detectRecurrence(makeItem({ description: 'Todos os documentos estão disponíveis. sexta-feira (25/09). até as 17h.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  // Exemplos reais que expuseram F9 (São Pedro da Aldeia, população real)
  it('exemplo real — Teatro Municipal, "neste sábado (03/10)" → sem recorrência', () => {
    const r = detectRecurrence(makeItem({
      description: 'O Teatro Municipal Dr. Átila Costa, em São Pedro da Aldeia, recebe neste sábado (03/10), às 19h, o espetáculo Um Final Não Tão Feliz.',
    }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('exemplo real — Dia D de Vacinação, "neste sábado (26/09)" → sem recorrência', () => {
    const r = detectRecurrence(makeItem({
      description: 'A Prefeitura, por meio da Secretaria de Saúde, realiza neste sábado (26/09) o Dia D de Vacinação Antirrábica, das 8h às 12h.',
    }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('exemplo real — Sonic ao Vivo, "neste domingo (13/09)" → sem recorrência', () => {
    const r = detectRecurrence(makeItem({
      description: 'Sonic e sua turma chegam pela primeira vez a São Pedro da Aldeia neste domingo (13/09). O espetáculo Sonic ao Vivo, às 15h.',
    }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('F6 compatibilidade — Feira real ainda qualifica após F9', () => {
    expect(hasQualifyingRecurrenceEvidence('Toda sexta-feira, cães e gatos encontram lar. Acontece das 10h às 15h.')).toBe(true);
  });
});

// Activity 13/26, F10, 2026-09-29 — F10-A (gramática de data inversa)
// + F10-B (ambiguidade léxica de "segunda/terça/quarta/quinta/sexta"
// como ordinais comuns, com preservação da lista abreviada já
// suportada desde a Activity 8).
describe('detectRecurrence — Activity 13 F10-A (gramática de data invertida: "DD de mês (dia-da-semana)")', () => {
  it('Starlight Concert (real) — "no dia 02 de outubro (sexta-feira)" + horário → sem recorrência', () => {
    const r = detectRecurrence(makeItem({
      description: 'O projeto Starlight Concert está de volta ao Teatro Municipal. A apresentação será no dia 02 de outubro (sexta-feira), com uma sessão extra às 19h, além da sessão das 21h.',
    }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('"20 de setembro (domingo)" + horário → sem recorrência', () => {
    const r = detectRecurrence(makeItem({ description: 'O concerto acontece no dia 20 de setembro (domingo), às 17h.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('"18 de setembro (sexta-feira)" + horário → sem recorrência', () => {
    const r = detectRecurrence(makeItem({ description: 'O evento acontece no dia 18 de setembro (sexta-feira), às 18h.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('regressão — forma directa "sexta-feira (25/09)" continua a funcionar (F5/F9, inalterado)', () => {
    const r = detectRecurrence(makeItem({ description: 'sexta-feira (25/09), o evento. até as 17h, prazo.' }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });
});

describe('detectRecurrence — Activity 13 F10-B (ambiguidade léxica: dias abreviados como ordinais comuns)', () => {
  it('1. contrato existente PRESERVADO — "Quartas e sextas das 9h às 11h" (Activity 8, Caso C, sem sufixo -feira)', () => {
    const r = detectRecurrence(makeItem({ description: 'Quartas e sextas das 9h às 11h' }));
    expect(r.recurrence.recurrence_type).toBe('weekly');
    expect(r.recurrence.recurrence_days).toEqual([3, 5]);
  });

  it('2. lista de 3 dias abreviados + horário → preservado', () => {
    const r = detectRecurrence(makeItem({ description: 'Segundas, quartas e sextas das 9h às 11h' }));
    expect(r.recurrence.recurrence_days).toEqual([1, 3, 5]);
  });

  it('3. lista abreviada + horário único (sem intervalo) → preservado', () => {
    const r = detectRecurrence(makeItem({ description: 'Quartas e sextas às 19h' }));
    expect(r.recurrence.recurrence_days).toEqual([3, 5]);
  });

  it('4-5. formas completas continuam inequívocas', () => {
    expect(detectRecurrence(makeItem({ description: 'segunda-feira das 9h às 11h' })).recurrence.recurrence_days).toEqual([1]);
    expect(detectRecurrence(makeItem({ description: 'sexta-feira às 19h' })).recurrence.recurrence_days).toEqual([5]);
  });

  it('6-8. recorrência genuína completa (todo/toda + dia + horário) preservada', () => {
    expect(detectRecurrence(makeItem({ description: 'toda sexta-feira das 10h às 15h' })).recurrence.recurrence_type).toBe('weekly');
    expect(detectRecurrence(makeItem({ description: 'todo sábado às 10h' })).recurrence.recurrence_type).toBe('weekly');
    expect(detectRecurrence(makeItem({ description: 'todo domingo às 10h' })).recurrence.recurrence_type).toBe('weekly');
  });

  it('9-14. ordinais comuns NUNCA viram dia da semana', () => {
    expect(detectRecurrence(makeItem({ description: 'não deve deixar de prestigiar essa segunda apresentação' })).recurrence.recurrence_type).toBeNull();
    expect(detectRecurrence(makeItem({ description: 'esta é a segunda edição do evento' })).recurrence.recurrence_type).toBeNull();
    expect(detectRecurrence(makeItem({ description: 'pela segunda vez este ano' })).recurrence.recurrence_type).toBeNull();
    expect(detectRecurrence(makeItem({ description: 'a quarta edição do festival' })).recurrence.recurrence_type).toBeNull();
    expect(detectRecurrence(makeItem({ description: 'a quinta edição da mostra' })).recurrence.recurrence_type).toBeNull();
    expect(detectRecurrence(makeItem({ description: 'a sexta edição da mostra' })).recurrence.recurrence_type).toBeNull();
  });

  it('15. caso crítico misto — sábado datado + "segunda apresentação" (ordinal) → sem recorrência (real, Teatro Municipal)', () => {
    const r = detectRecurrence(makeItem({
      description: 'neste sábado (03/10), às 19h, acontece a segunda apresentação',
    }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('16. lista abreviada + ordinal separado — lista preservada, ordinal não adiciona dia', () => {
    const r = detectRecurrence(makeItem({ description: 'Quartas e sextas das 9h às 11h. Esta é a segunda edição do projeto.' }));
    expect(r.recurrence.recurrence_days).toEqual([3, 5]);
  });

  it('17. recorrência completa genuína + ordinal separado — ordinal não adiciona dia', () => {
    const r = detectRecurrence(makeItem({ description: 'Toda sexta-feira, das 10h às 15h. Esta é a segunda edição.' }));
    expect(r.recurrence.recurrence_days).toEqual([5]);
  });

  it('exemplo real — Teatro Municipal, artigo completo (sábado datado + "segunda apresentação" ordinal) → sem recorrência', () => {
    const r = detectRecurrence(makeItem({
      description:
        'O Teatro Municipal Dr. Átila Costa, em São Pedro da Aldeia, recebe neste sábado (03/10), às 19h, ' +
        'o espetáculo Um Final Não Tão Feliz, do Coletivo AVENOAR. A classificação indicativa é de 14 anos. ' +
        'Acredito que quem assistiu da primeira vez não deve deixar de prestigiar essa segunda apresentação, ' +
        'pois teremos cenas novas.',
    }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('regressão F5/F8/F9 — PNAB real completo continua limpo', () => {
    const r = detectRecurrence(makeItem({
      description:
        'A Secretaria Municipal de Cultura divulgou, nesta sexta-feira (25/09), o resultado final. ' +
        'Também foi divulgado o resultado dos recursos. Todos os documentos estão disponíveis. ' +
        'As dúvidas devem ser encaminhadas até as 17h, no horário de Brasília.',
    }));
    expect(r.recurrence.recurrence_type).toBeNull();
  });

  it('regressão F6 — Feira real continua a qualificar e a produzir weekly/[5]/10:00', () => {
    const r = detectRecurrence(makeItem({
      description: 'Toda sexta-feira, cães e gatos encontram lar. Acontece das 10h às 15h.',
    }));
    expect(r.recurrence).toEqual({
      recurrence_type: 'weekly',
      recurrence_days: [5],
      recurrence_time: '10:00',
      review_reasons: ['recurrence_end_time_not_persisted'],
    });
  });
});
