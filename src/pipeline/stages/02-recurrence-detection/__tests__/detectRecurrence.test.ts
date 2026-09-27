/**
 * src/pipeline/stages/02-recurrence-detection/__tests__/detectRecurrence.test.ts
 *
 * Activity 8/26, 2026-09-26. Cobertura dos casos A-K aprovados.
 */

import { describe, it, expect } from 'vitest';
import { detectRecurrence, detectRecurrenceItems } from '../detectRecurrence';
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
});
