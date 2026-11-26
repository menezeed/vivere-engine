/**
 * Textos e regras de apresentação da elegibilidade 60+ (Issue #62).
 * Puro e sem alias '@', para ser testado pelo Vitest da raiz.
 * Regra principal: desconhecido aparece como "Não confirmado", nunca "gratuito".
 */
import type {
  EligibilityAvailability, EligibilityClass, EligibilityFilterValue, EligibilitySummary, EligibilityType, MembershipInfo,
  EligibilityReviewInput, EligibilityConfidence, HumanReviewState,
} from '../../types/eligibility';

export const NOT_CONFIRMED = 'Não confirmado';

export type BadgeTone = 'green' | 'teal' | 'amber' | 'red' | 'gray';

export const CLASS_LABEL: Record<EligibilityClass, { label: string; tone: BadgeTone }> = {
  confirmed_60plus: { label: '60+ confirmado',          tone: 'green' },
  likely_suitable:  { label: 'Provavelmente adequada',  tone: 'teal' },
  unclear:          { label: 'Não confirmado',          tone: 'amber' },
  unsuitable:       { label: 'Não adequada',            tone: 'red' },
};

/** Badge da lista e do detalhe. null = produto sem auditoria (não mostrar nada). */
export function eligibilityBadge(e: EligibilitySummary | null | undefined): { label: string; tone: BadgeTone } | null {
  if (!e) return null;
  // Revisão humana válida prevalece (inclusive sobre um dataset sem correspondência).
  if (e.review_source === 'human_review' && e.classification) return CLASS_LABEL[e.classification];
  if (e.status === 'mismatch') return { label: 'Dados não correspondem', tone: 'red' };
  // "Sem auditoria" (ninguém classificou) ≠ "Não adequada" (classificada como inadequada).
  if (e.status === 'not_audited' || !e.classification) return { label: 'Sem auditoria (por rever)', tone: 'gray' };
  return CLASS_LABEL[e.classification];
}

export const FILTER_OPTIONS: Array<{ value: EligibilityFilterValue; label: string }> = [
  { value: 'confirmed_60plus', label: '60+ confirmado' },
  { value: 'likely_suitable',  label: 'Provavelmente adequada' },
  { value: 'unclear',          label: 'Não confirmado' },
  { value: 'unsuitable',       label: 'Não adequada' },
  { value: 'not_audited',      label: 'Sem auditoria' },
];

export const AVAILABILITY_LABEL: Record<EligibilityAvailability, string> = {
  open:         'Aberto a novos membros',
  waiting_list: 'Cheio, lista de espera',
  closed:       'Fechado a novos membros',
  unknown:      NOT_CONFIRMED,
};

export const ELIGIBILITY_TYPE_LABEL: Record<EligibilityType, string> = {
  exclusive_60plus: 'Exclusivo 60+',
  open_to_60plus:   'Aberto a 60+ (sem limite de idade)',
  unknown:          NOT_CONFIRMED,
  not_applicable:   'Não é uma actividade',
};

export const CONFIDENCE_LABEL = { high: 'Alta', medium_high: 'Média-alta', medium: 'Média', low: 'Baixa' } as const;

export function availabilityText(a: EligibilityAvailability | null | undefined): string {
  return a ? AVAILABILITY_LABEL[a] : NOT_CONFIRMED;
}

/** Custos adicionais: null → "Não confirmado" (NUNCA "gratuito"). */
export function additionalCostsText(c: string | null | undefined): string {
  return c && c.trim() ? c : `${NOT_CONFIRMED} (a página não indica custos; não significa gratuito)`;
}

export function membershipText(required: true | null | undefined): string {
  return required === true ? 'Só membros da u3a (exige quota de associação)' : NOT_CONFIRMED;
}

export function textOrNotConfirmed(v: string | null | undefined): string {
  return v && v.trim() ? v : NOT_CONFIRMED;
}

/** "£15,00" — formato pt com a moeda da fonte. */
export function formatFee(amount: number, currency: string): string {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency }).format(amount);
}

export function membershipFeeLines(m: MembershipInfo): string[] {
  return m.fees.map(f => `${f.label}: ${formatFee(f.amount, m.currency)}${f.per_person ? ' por pessoa' : ''} — ${f.description}`);
}

/** Acções de revisão visíveis. A autoridade é o servidor (403); isto só evita cliques inúteis. */
export function visibleReviewActions<T extends string>(actions: T[], e: EligibilitySummary | null | undefined): T[] {
  if (!e || e.approval_allowed) return actions;
  return actions.filter(a => a !== 'approve' && a !== 'promote');
}

/** Encode do filtro para o URL/API (?eligibility=a,b). */
export function parseFilterParam(raw: string | undefined): EligibilityFilterValue | undefined {
  return FILTER_OPTIONS.some(o => o.value === raw) ? raw as EligibilityFilterValue : undefined;
}

// ── Revisão humana (Issue #62) ──────────────────────────────────────────────

export const REVIEW_SOURCE_LABEL = {
  human_review: 'Revisão humana',
  audit_dataset: 'Auditoria (dataset)',
  none: 'Sem classificação',
} as const;

export const REVIEW_STATE_LABEL: Record<HumanReviewState, string> = {
  valid: 'Válida',
  stale_key: 'Obsoleta: a actividade mudou (fonte, id ou URL) — rever de novo',
  expired: 'Expirada: verificação com mais de 180 dias — rever de novo',
};

const CLASSES: readonly EligibilityClass[] = ['confirmed_60plus', 'likely_suitable', 'unclear', 'unsuitable'];
const CONFS: readonly EligibilityConfidence[] = ['high', 'medium_high', 'medium', 'low'];
const AVAILS: readonly EligibilityAvailability[] = ['open', 'waiting_list', 'closed', 'unknown'];

/** Data local AAAA-MM-DD. */
export function todayYmd(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Valores iniciais do formulário: a proposta automática do colector
 * (raw_payload.eligibility_proposal) e o URL oficial da actividade. O revisor
 * confirma ou corrige; nada é gravado sem submeter.
 */
export function reviewFormDefaults(a: { external_url?: string | null; raw_payload?: Record<string, unknown> }, today = todayYmd()): EligibilityReviewInput {
  const p = (a.raw_payload?.['eligibility_proposal'] ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed as readonly unknown[]).includes(v) ? v as T : fallback;
  return {
    classification: pick(p['classification'], CLASSES, 'unclear'),
    confidence: pick(p['confidence'], CONFS, 'medium'),
    evidence_text: typeof p['evidence'] === 'string' ? p['evidence'] : '',
    evidence_url: a.external_url ?? '',
    audience: typeof p['access_notes'] === 'string' ? p['access_notes'] : null,
    membership_required: p['membership_required'] === true ? true : null,
    booking: null,
    availability: pick(p['availability'], AVAILS, 'unknown'),
    additional_costs: typeof p['additional_costs'] === 'string' ? p['additional_costs'] : null,
    verified_at: today,
    notes: null,
  };
}

/** Validação imediata no formulário (espelho da do servidor, que é a que decide). */
export function validateReviewForm(f: EligibilityReviewInput, today = todayYmd()): string[] {
  const out: string[] = [];
  const personal = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\(?\d[\d ().-]{8,}\d/;
  if (f.evidence_text.trim().length < 20) out.push('A evidência tem de ter pelo menos 20 caracteres.');
  if (!/^https:\/\/\S{4,490}$/.test(f.evidence_url.trim())) out.push('O URL da evidência tem de ser https.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.verified_at)) out.push('Data de verificação inválida.');
  else if (f.verified_at > today) out.push('A data de verificação não pode ser no futuro.');
  if (f.classification === 'confirmed_60plus' && f.confidence === 'low') out.push('"60+ confirmado" não pode ter confiança baixa.');
  for (const [k, v] of [['evidência', f.evidence_text], ['público-alvo', f.audience], ['inscrição', f.booking], ['custos', f.additional_costs], ['notas', f.notes]] as const) {
    if (v && personal.test(v)) out.push(`O campo ${k} não pode ter e-mails ou telefones.`);
  }
  return out;
}
