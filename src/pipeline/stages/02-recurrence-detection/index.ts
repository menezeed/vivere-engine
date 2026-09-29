/**
 * src/pipeline/stages/02-recurrence-detection/index.ts
 *
 * Activity 8/26, 2026-09-26. Mesmo padrão de export de
 * 00-filter-venue/index.ts.
 *
 * Activity 13/26, F6, 2026-09-28 — hasQualifyingRecurrenceEvidence
 * acrescentada: lógica pura de qualificação de recorrência, reutilizada
 * por narrativeFallbackParser.ts (Collector) para decidir se deve criar
 * um RawActivityItem mesmo sem data concreta — nunca para calcular
 * recurrence_type/days/time, que continuam exclusivos de detectRecurrence().
 */
export type {
  RecurrenceType,
  RecurrenceReviewReason,
  RecurrenceDetectionResult,
  RecurrenceDetectedItem,
} from './types.js';

export { detectRecurrence, detectRecurrenceItems, hasQualifyingRecurrenceEvidence } from './detectRecurrence.js';