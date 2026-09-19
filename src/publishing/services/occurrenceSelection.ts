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
 * Nota em aberto (não coberta pela ADR-0020, assumida por falta de
 * especificação): date+time são combinados como UTC puro
 * (`${date}T${time}:00Z`). occurrences não tem informação de fuso-horário na
 * origem (raw_activity_items). Se os horários forem horário local de Cabo
 * Frio (America/Sao_Paulo, UTC-3), a comparação com asOf pode desviar até 3h
 * perto de meia-noite — irrelevante para a cadência diária de publish.ts,
 * mas fica registado para quando o produto expandir para fusos diferentes.
 */

import type { ActivityOccurrence } from '../types/domain.js';

/** Combina date + time (ou meia-noite, se time for null) num Date UTC. */
function occurrenceDateTime(occurrence: ActivityOccurrence): Date {
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
    .map(occurrence => ({ occurrence, dateTime: occurrenceDateTime(occurrence) }))
    .filter(entry => entry.dateTime.getTime() >= asOf.getTime())
    .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());

  return future.length > 0 ? future[0]!.occurrence : null;
}

/** Combina uma ActivityOccurrence já seleccionada em start_date/end_date (Date | null). */
export function occurrenceToDateRange(occurrence: ActivityOccurrence): { startDate: Date; endDate: Date | null } {
  return {
    startDate: occurrenceDateTime(occurrence),
    endDate:   occurrence.endDate
      ? new Date(`${occurrence.endDate}T${occurrence.endTime ?? '00:00'}:00Z`)
      : null,
  };
}
