/**
 * src/publishing/services/occurrenceSelection.ts
 *
 * Sprint 8.7 — ADR-0020 (Política de Publicação de Activities com Múltiplas
 * Ocorrências).
 *
 * Função pura, isolada do PublicationTransformer para ser testável de forma
 * independente. Selecciona, de um array de ActivityOccurrence, a primeira
 * ocorrência cuja data/hora seja >= asOf. `asOf` é sempre injectado pelo
 * chamador — nunca lido de new Date()/Date.now() aqui.
 *
 * 15/11/2026 — fuso horário (correcção da "nota em aberto" anterior):
 * date/time das occurrences são hora LOCAL das fontes (prefeituras do RJ,
 * America/Sao_Paulo, UTC−3 fixo desde o fim do horário de verão em 2019).
 *
 *  - COMPARAÇÃO com asOf (o que decide futuro/expirado, ADR-0020): usa o
 *    instante real, `${date}T${time}:00-03:00`. Antes era `…Z`, e um evento
 *    às 06:00 locais era dado como passado às 03:01 locais (3 h cedo).
 *    Ocorrência só com data (time null) conta até ao FIM desse dia local
 *    (23:59:59−03:00): antes expirava às 21:00 locais da véspera.
 *  - ARMAZENAMENTO (occurrenceToDateRange → start_date/end_date): mantém a
 *    convenção existente, hora local com sufixo Z. O app usa
 *    start_date.slice(0,10) e a vista active_activities compara a data com
 *    current_date; gravar o instante UTC real mudaria a data de eventos
 *    depois das 21:00 locais. Não alterado aqui de propósito.
 *
 * LIMITAÇÃO CONHECIDA (revisão r0, fora do engine): a vista
 * public.active_activities filtra `start_date >= current_date` com
 * current_date em UTC. Entre as 21:00 e as 24:00 locais, um evento pontual
 * desse dia (gravado com a data local) já não satisfaz o filtro, mesmo que
 * o engine o considere futuro. Corrigir exige migration da vista (ex.:
 * current_date AT TIME ZONE 'America/Sao_Paulo'), decisão separada do PO.
 * Fixado pelo teste "contrato com a vista" em occurrenceSelection.test.ts.
 */

import type { ActivityOccurrence } from '../types/domain.js';

/** Deslocamento UTC da hora local das fontes actuais (America/Sao_Paulo, sem horário de verão). */
export const SOURCE_LOCAL_UTC_OFFSET = '-03:00';

/**
 * Instante REAL em que a ocorrência deixa de ser futura (só para comparar
 * com asOf). Com hora: início local. Só data: fim do dia local.
 */
export function occurrenceComparisonInstant(occurrence: ActivityOccurrence): Date {
  if (occurrence.time === null) {
    // Último milissegundo do dia local (revisão r0: 23:59:59.000 deixava
    // de fora os 999 ms finais). Equivale a "antes da meia-noite seguinte".
    const startOfDay = new Date(`${occurrence.date}T00:00:00${SOURCE_LOCAL_UTC_OFFSET}`).getTime();
    return new Date(startOfDay + 24 * 60 * 60 * 1000 - 1);
  }
  return new Date(`${occurrence.date}T${occurrence.time}:00${SOURCE_LOCAL_UTC_OFFSET}`);
}

/**
 * Valor GRAVADO em start_date: hora local com sufixo Z (convenção do app e
 * da vista active_activities — ver cabeçalho). Meia-noite se time for null.
 */
function storedDateTime(occurrence: ActivityOccurrence): Date {
  const time = occurrence.time ?? '00:00';
  return new Date(`${occurrence.date}T${time}:00Z`);
}

/**
 * Devolve a primeira ocorrência com data/hora >= asOf, ordenando por
 * data/hora ascendente. Devolve null se todas as ocorrências já passaram
 * (ou se o array estiver vazio) — ADR-0020, regra 5: nunca cai de volta
 * silenciosamente para a última ocorrência passada.
 */
export function selectNextOccurrence(
  occurrences: readonly ActivityOccurrence[],
  asOf: Date,
): ActivityOccurrence | null {
  const future = occurrences
    .map(occurrence => ({ occurrence, dateTime: occurrenceComparisonInstant(occurrence) }))
    .filter(entry => entry.dateTime.getTime() >= asOf.getTime())
    .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());

  return future.length > 0 ? future[0]!.occurrence : null;
}

/** Combina uma ActivityOccurrence já seleccionada em start_date/end_date (Date | null). */
export function occurrenceToDateRange(occurrence: ActivityOccurrence): { startDate: Date; endDate: Date | null } {
  return {
    startDate: storedDateTime(occurrence),
    endDate:   occurrence.endDate
      ? new Date(`${occurrence.endDate}T${occurrence.endTime ?? '00:00'}:00Z`)
      : null,
  };
}
