/**
 * Revisão humana de elegibilidade 60+ (Issue #62, piloto UK).
 *
 * Um revisor regista uma CLASSIFICAÇÃO FUNDAMENTADA (evidência + URL oficial
 * + data de verificação). Fica em staging.activity_eligibility_reviews
 * (migração 0033, append-only); a última revisão prevalece sobre o dataset
 * auditado.
 *
 * Regra de aprovação (servidor; a UI só a reflecte):
 *   approve/promote só se a classificação efectiva for confirmed_60plus E,
 *   quando vem de revisão humana:
 *     - a revisão é desta actividade com a MESMA chave (fonte, id, URL) que
 *       a actividade tem hoje (senão: "obsoleta");
 *     - verified_at tem no máximo MAX_REVIEW_AGE_DAYS dias.
 *   Sem revisão humana, mantém-se a regra do dataset auditado.
 * Classificação ≠ aprovação: registar a revisão não muda proposal_status.
 */
import { ELIGIBILITY_CLASSES, type EligibilityClass } from './eligibilityAudit';

export const REVIEW_CONFIDENCES = ['high', 'medium_high', 'medium', 'low'] as const;
export const REVIEW_AVAILABILITIES = ['open', 'waiting_list', 'closed', 'unknown'] as const;
export const MAX_REVIEW_AGE_DAYS = 180;
export const MAX_VERIFIED_AGE_DAYS_ON_SUBMIT = 365;

export interface EligibilityReviewInput {
  classification: EligibilityClass;
  confidence: (typeof REVIEW_CONFIDENCES)[number];
  evidence_text: string;
  evidence_url: string;
  audience: string | null;
  membership_required: boolean | null;
  booking: string | null;
  availability: (typeof REVIEW_AVAILABILITIES)[number];
  additional_costs: string | null;
  verified_at: string; // YYYY-MM-DD
  notes: string | null;
}

export interface EligibilityReviewRow extends EligibilityReviewInput {
  id: string;
  activity_staging_id: string;
  product_key: string;
  source_key: string;
  source_item_id: string;
  external_url: string | null;
  reviewed_by: string;
  reviewed_role: 'reviewer' | 'admin';
  reviewed_at: string;
}

export class ReviewValidationError extends Error {
  readonly statusCode = 400;
  constructor(readonly issues: string[]) { super(`Revisão inválida: ${issues.join('; ')}`); this.name = 'ReviewValidationError'; }
}

const PERSONAL = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\(?\d[\d ().-]{8,}\d/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(fromYmd: string, to: Date): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const t = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((t - from) / 86_400_000);
}

/** Validação estrita do corpo do POST; devolve o input normalizado ou lança 400 com a lista de problemas. */
export function parseEligibilityReviewInput(body: unknown, now = new Date()): EligibilityReviewInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const issues: string[] = [];
  const str = (k: string, min: number, max: number, required: boolean): string | null => {
    const v = b[k];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (required) issues.push(`${k} é obrigatório`);
      return null;
    }
    if (typeof v !== 'string') { issues.push(`${k} tem de ser texto`); return null; }
    const t = v.trim();
    if (t.length < min || t.length > max) issues.push(`${k} tem de ter entre ${min} e ${max} caracteres`);
    if (PERSONAL.test(t) && k !== 'evidence_url') issues.push(`${k} não pode conter e-mails ou telefones`);
    return t;
  };
  const oneOf = <T extends string>(k: string, allowed: readonly T[]): T | null => {
    const v = b[k];
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) { issues.push(`${k} inválido (${allowed.join(', ')})`); return null; }
    return v as T;
  };

  const classification = oneOf('classification', ELIGIBILITY_CLASSES);
  const confidence = oneOf('confidence', REVIEW_CONFIDENCES);
  const availability = oneOf('availability', REVIEW_AVAILABILITIES);
  const evidence_text = str('evidence_text', 20, 2000, true);
  const evidence_url = str('evidence_url', 12, 500, true);
  if (evidence_url && !/^https:\/\/[^\s]{4,490}$/.test(evidence_url)) issues.push('evidence_url tem de ser um URL https sem espaços');
  const audience = str('audience', 2, 300, false);
  const booking = str('booking', 2, 300, false);
  const additional_costs = str('additional_costs', 1, 300, false);
  const notes = str('notes', 2, 1000, false);
  const m = b['membership_required'];
  if (m !== undefined && m !== null && typeof m !== 'boolean') issues.push('membership_required tem de ser true, false ou null');

  const verified_at = typeof b['verified_at'] === 'string' ? b['verified_at'] : '';
  if (!YMD.test(verified_at) || Number.isNaN(Date.parse(`${verified_at}T00:00:00Z`))) {
    issues.push('verified_at tem de ser uma data AAAA-MM-DD');
  } else {
    const age = daysBetween(verified_at, now);
    if (age < 0) issues.push('verified_at não pode ser no futuro');
    else if (age > MAX_VERIFIED_AGE_DAYS_ON_SUBMIT) issues.push(`verified_at tem mais de ${MAX_VERIFIED_AGE_DAYS_ON_SUBMIT} dias`);
    else if (classification === 'confirmed_60plus' && age > MAX_REVIEW_AGE_DAYS) {
      issues.push(`para confirmed_60plus, verified_at tem de ter no máximo ${MAX_REVIEW_AGE_DAYS} dias`);
    }
  }
  if (classification === 'confirmed_60plus' && confidence === 'low') issues.push('confirmed_60plus não pode ter confiança baixa');

  if (issues.length) throw new ReviewValidationError(issues);
  return {
    classification: classification!, confidence: confidence!, evidence_text: evidence_text!, evidence_url: evidence_url!,
    audience, membership_required: (m as boolean | null | undefined) ?? null, booking, availability: availability!,
    additional_costs, verified_at, notes,
  };
}

export interface ActivityKeyNow {
  product_key: string;
  source_key: string | null;
  source_item_id: string | null;
  external_url: string | null;
}

export type HumanReviewState = 'valid' | 'stale_key' | 'expired';

/** Estado de uma revisão face à actividade hoje. */
export function humanReviewState(r: EligibilityReviewRow, key: ActivityKeyNow, now = new Date()): HumanReviewState {
  if (r.product_key !== key.product_key || r.source_key !== key.source_key
      || r.source_item_id !== key.source_item_id || (r.external_url ?? null) !== (key.external_url ?? null)) return 'stale_key';
  if (daysBetween(r.verified_at, now) > MAX_REVIEW_AGE_DAYS) return 'expired';
  return 'valid';
}

/** A revisão humana (válida) permite approve/promote? */
export function humanReviewAllowsApproval(r: EligibilityReviewRow, key: ActivityKeyNow, now = new Date()): boolean {
  return r.classification === 'confirmed_60plus' && humanReviewState(r, key, now) === 'valid';
}

/** Resumo público (lista/detalhe). Nunca inclui texto livre longo na lista. */
export interface HumanReviewSummary {
  classification: EligibilityClass;
  confidence: EligibilityReviewRow['confidence'];
  verified_at: string;
  reviewed_by: string;
  reviewed_at: string;
  state: HumanReviewState;
}

export function summarizeReview(r: EligibilityReviewRow, key: ActivityKeyNow, now = new Date()): HumanReviewSummary {
  return { classification: r.classification, confidence: r.confidence, verified_at: r.verified_at,
    reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at, state: humanReviewState(r, key, now) };
}

/** Revisões humanas ligadas? Desligado por omissão: só depois de aplicar a migração 0033. */
export function isHumanReviewEnabled(env: Record<string, string | undefined>): boolean {
  return (env['REVIEW_API_ELIGIBILITY_REVIEWS'] ?? 'off').toLowerCase() === 'on';
}
