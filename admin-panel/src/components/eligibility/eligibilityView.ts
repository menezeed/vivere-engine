/**
 * Textos e regras de apresentação da elegibilidade 60+ (Issue #62).
 * Puro e sem alias '@', para ser testado pelo Vitest da raiz.
 * Regra principal: desconhecido aparece como "Não confirmado", nunca "gratuito".
 */
import type {
  EligibilityAvailability, EligibilityClass, EligibilityFilterValue, EligibilitySummary, EligibilityType, MembershipInfo,
} from '../../types/eligibility';

export const NOT_CONFIRMED = 'Não confirmado';

export type BadgeTone = 'green' | 'teal' | 'amber' | 'red' | 'gray';

export const CLASS_LABEL: Record<EligibilityClass, { label: string; tone: BadgeTone }> = {
  confirmed_60plus: { label: '60+ confirmado',          tone: 'green' },
  likely_suitable:  { label: 'Provavelmente adequada',  tone: 'teal' },
  unclear:          { label: 'Não confirmado',          tone: 'amber' },
  unsuitable:       { label: 'Inadequada',              tone: 'red' },
};

/** Badge da lista e do detalhe. null = produto sem auditoria (não mostrar nada). */
export function eligibilityBadge(e: EligibilitySummary | null | undefined): { label: string; tone: BadgeTone } | null {
  if (!e) return null;
  if (e.status === 'mismatch') return { label: 'Dados não correspondem', tone: 'red' };
  if (e.status === 'not_audited' || !e.classification) return { label: 'Sem auditoria', tone: 'gray' };
  return CLASS_LABEL[e.classification];
}

export const FILTER_OPTIONS: Array<{ value: EligibilityFilterValue; label: string }> = [
  { value: 'confirmed_60plus', label: '60+ confirmado' },
  { value: 'likely_suitable',  label: 'Provavelmente adequada' },
  { value: 'unclear',          label: 'Não confirmado' },
  { value: 'unsuitable',       label: 'Inadequada' },
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
