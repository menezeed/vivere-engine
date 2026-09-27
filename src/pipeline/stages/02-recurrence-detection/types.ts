/**
 * src/pipeline/stages/02-recurrence-detection/types.ts
 *
 * Activity 8/26, 2026-09-26 — Recurrence Detection.
 *
 * Mesmo padrão dos estágios existentes (00-filter-venue,
 * 01-geographic-gate): tipos puros, sem acoplamento a Supabase.
 */

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

/**
 * Level 2, 2026-09-26 — sinais de auditoria para casos loss-aware.
 * Mesmo padrão de MapReviewReason (collectors) — union fechada,
 * nunca um enum global novo. A evidência completa permanece em
 * recurrence_text_hint, nunca só nestes sinais.
 */
export type RecurrenceReviewReason =
  | 'recurrence_end_time_not_persisted'
  | 'recurrence_per_day_times_not_representable';

/**
 * Resultado do detector para uma RawActivityItem. type/days/time
 * permanecem NULL (nunca 'none' literal) quando nenhuma recorrência
 * foi detectada — a normalização para 'none' pertence à Activity 9
 * (Publishing), não a este estágio.
 */
export interface RecurrenceDetectionResult {
  readonly recurrence_type: RecurrenceType | null;
  readonly recurrence_days: readonly number[] | null;
  readonly recurrence_time: string | null;
  readonly review_reasons: readonly RecurrenceReviewReason[];
}

/**
 * Item envolvido, mesmo padrão de FilteredVenueItem
 * (00-filter-venue). item pode ter recurrence_text_hint populado
 * (nunca outro campo) face ao RawActivityItem original — nunca
 * mutado in-place, sempre um objecto novo.
 */
export interface RecurrenceDetectedItem {
  readonly item: import('../../../types/RawActivityItem').RawActivityItem;
  readonly recurrence: RecurrenceDetectionResult;
}
