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
