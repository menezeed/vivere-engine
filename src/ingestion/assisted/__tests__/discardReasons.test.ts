/**
 * Descartes do collector agregados por CLASSE (sem conteúdo dos posts):
 * countErrorsByReason (orquestrador) e formatDiscardReasons (resumo do
 * dry-run / execução assistida).
 */
import { describe, it, expect } from 'vitest';
import { countErrorsByReason } from '../../../persistence/orchestration/IngestionOrchestrator';
import { formatDiscardReasons } from '../runAssisted';

describe('countErrorsByReason', () => {
  it('agrega pelo prefixo "motivo:" e nunca guarda o resto da mensagem', () => {
    const byReason = countErrorsByReason([
      { message: 'narrative_ambiguous: post 1 ("Título com dados"): múltiplas datas' },
      { message: 'narrative_ambiguous: post 2 ("Outro")' },
      { message: 'no_extractable_schedule_found: post 3 ("X")' },
      { message: 'mensagem livre sem classe' },
    ]);
    expect(byReason).toEqual({ narrative_ambiguous: 2, no_extractable_schedule_found: 1, other: 1 });
    expect(JSON.stringify(byReason)).not.toContain('Título');
  });

  it('lista vazia → objeto vazio', () => {
    expect(countErrorsByReason([])).toEqual({});
  });
});

describe('formatDiscardReasons', () => {
  it('ordena por contagem e depois por nome', () => {
    expect(formatDiscardReasons({ no_extractable_schedule_found: 3, narrative_ambiguous: 7 })).toBe(
      ' (narrative_ambiguous 7, no_extractable_schedule_found 3)',
    );
  });
  it('vazio, null ou só zeros → nada', () => {
    expect(formatDiscardReasons(null)).toBe('');
    expect(formatDiscardReasons(undefined)).toBe('');
    expect(formatDiscardReasons({ narrative_ambiguous: 0 })).toBe('');
  });
  it('chaves que não são identificadores simples nunca são impressas', () => {
    expect(formatDiscardReasons({ 'Título "x": y': 1, narrative_ambiguous: 1 })).toBe(' (narrative_ambiguous 1)');
  });
});
