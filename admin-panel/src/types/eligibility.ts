/**
 * Elegibilidade 60+ (Issue #62). Espelho do contrato da Review API:
 * docs/operacao/CONTRATO-ELEGIBILIDADE-60PLUS.md. A fonte única dos dados é a
 * Review API (src/review-api/eligibility); o Admin não tem cópia dos dados.
 */
export type EligibilityClass = 'confirmed_60plus' | 'likely_suitable' | 'unclear' | 'unsuitable';
export type EligibilityFilterValue = EligibilityClass | 'not_audited';
export type EligibilityStatus = 'matched' | 'not_audited' | 'mismatch';
export type EligibilityConfidence = 'high' | 'medium_high' | 'medium' | 'low';
export type EligibilityAvailability = 'open' | 'waiting_list' | 'closed' | 'unknown';
export type EligibilityType = 'exclusive_60plus' | 'open_to_60plus' | 'unknown' | 'not_applicable';

export interface EligibilitySummary {
  status: EligibilityStatus;
  classification: EligibilityClass | null;
  confidence: EligibilityConfidence | null;
  availability: EligibilityAvailability | null;
  approval_allowed: boolean;
  needs_human_review: boolean;
  /** Origem da classificação efectiva (revisão humana > dataset auditado). */
  review_source?: 'human_review' | 'audit_dataset' | 'none';
  /** Última revisão humana (state: valid | stale_key | expired). */
  human_review?: HumanReviewSummary | null;
}

export type HumanReviewState = 'valid' | 'stale_key' | 'expired';

export interface HumanReviewSummary {
  classification: EligibilityClass;
  confidence: EligibilityConfidence;
  verified_at: string;
  reviewed_by: string;
  reviewed_at: string;
  state: HumanReviewState;
}

/** Corpo do POST /api/activities/:id/eligibility-reviews. */
export interface EligibilityReviewInput {
  classification: EligibilityClass;
  confidence: EligibilityConfidence;
  evidence_text: string;
  evidence_url: string;
  audience: string | null;
  membership_required: boolean | null;
  booking: string | null;
  availability: EligibilityAvailability;
  additional_costs: string | null;
  verified_at: string;
  notes: string | null;
}

/** Linha da trilha de auditoria (append-only). */
export interface EligibilityReview extends EligibilityReviewInput {
  id: string;
  activity_staging_id: string;
  source_key: string;
  source_item_id: string;
  external_url: string | null;
  reviewed_by: string;
  reviewed_role: 'reviewer' | 'admin';
  reviewed_at: string;
}

export interface EligibilityRecord {
  source_item_id: string;
  source_url: string;
  title: string;
  kind: 'group' | 'event';
  classification: EligibilityClass;
  confidence: EligibilityConfidence;
  evidence: string;
  eligibility_type: EligibilityType;
  membership_required: true | null;
  availability: EligibilityAvailability;
  additional_costs: string | null;
  physical_activity: boolean;
  distances_cited: string[];
  levels_cited: string[];
  access_notes: string | null;
  schedule_complete_in_source: boolean;
  generic_venue: boolean;
  recommendation: string;
  human_review_notes: string[];
}

export interface MembershipInfo {
  organisation: string;
  source_url: string;
  verified_at: string;
  valid_until: string;
  currency: string;
  fees: Array<{ category: string; label: string; amount: number; per_person: boolean; description: string }>;
  note: string;
}

export interface EligibilityDetail extends EligibilitySummary {
  record: EligibilityRecord | null;
  membership: MembershipInfo | null;
  audit: { report: string; verified_at: string; schema_version: number };
  notice: string;
}
