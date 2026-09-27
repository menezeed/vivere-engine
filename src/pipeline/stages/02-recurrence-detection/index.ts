/**
 * src/pipeline/stages/02-recurrence-detection/index.ts
 *
 * Activity 8/26, 2026-09-26. Mesmo padrão de export de
 * 00-filter-venue/index.ts.
 */
export type {
  RecurrenceType,
  RecurrenceReviewReason,
  RecurrenceDetectionResult,
  RecurrenceDetectedItem,
} from './types.js';

export { detectRecurrence, detectRecurrenceItems } from './detectRecurrence.js';
