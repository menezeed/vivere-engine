/**
 * Issue #62 — regras de apresentação da elegibilidade 60+ no Admin.
 */
import { describe, it, expect } from 'vitest';
import {
  eligibilityBadge, additionalCostsText, availabilityText, membershipText, textOrNotConfirmed,
  membershipFeeLines, visibleReviewActions, parseFilterParam, NOT_CONFIRMED,
} from '../eligibilityView';
import type { EligibilitySummary } from '../../../types/eligibility';

const sum = (over: Partial<EligibilitySummary>): EligibilitySummary => ({
  status: 'matched', classification: 'likely_suitable', confidence: 'medium', availability: 'open',
  approval_allowed: false, needs_human_review: false, ...over,
});

describe('badge', () => {
  it.each([
    ['confirmed_60plus', '60+ confirmado'],
    ['likely_suitable', 'Provavelmente adequada'],
    ['unclear', 'Não confirmado'],
    ['unsuitable', 'Inadequada'],
  ] as const)('%s → %s', (cls, label) => {
    expect(eligibilityBadge(sum({ classification: cls }))?.label).toBe(label);
  });
  it('mismatch nunca mostra a classificação', () => {
    expect(eligibilityBadge(sum({ status: 'mismatch', classification: null }))?.label).toBe('Dados não correspondem');
  });
  it('not_audited → "Sem auditoria"; produto sem auditoria (null) → sem badge', () => {
    expect(eligibilityBadge(sum({ status: 'not_audited', classification: null }))?.label).toBe('Sem auditoria');
    expect(eligibilityBadge(null)).toBeNull();
    expect(eligibilityBadge(undefined)).toBeNull();
  });
});

describe('valores ausentes → "Não confirmado" (nunca gratuito)', () => {
  it('custos adicionais null', () => {
    const t = additionalCostsText(null);
    expect(t.startsWith(NOT_CONFIRMED)).toBe(true);
    expect(t).toMatch(/não significa gratuito/);
    expect(additionalCostsText('£6 por sessão')).toBe('£6 por sessão');
  });
  it('disponibilidade, adesão e textos', () => {
    expect(availabilityText(null)).toBe(NOT_CONFIRMED);
    expect(availabilityText('unknown')).toBe(NOT_CONFIRMED);
    expect(availabilityText('waiting_list')).toBe('Cheio, lista de espera');
    expect(membershipText(null)).toBe(NOT_CONFIRMED);
    expect(membershipText(true)).toMatch(/quota/);
    expect(textOrNotConfirmed('  ')).toBe(NOT_CONFIRMED);
  });
});

describe('quota', () => {
  it('linhas com valor e moeda da fonte, separadas dos custos', () => {
    const lines = membershipFeeLines({
      organisation: 'x', source_url: 'https://x', verified_at: '2026-11-26', valid_until: '2027-09-01', currency: 'GBP', note: 'n',
      fees: [{ category: 'joint', label: 'Joint', amount: 12.5, per_person: true, description: 'For 2 people at same address, each' }],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Joint: 12,50\s£ por pessoa — For 2 people/);
  });
});

describe('acções visíveis (o servidor continua a ser a autoridade)', () => {
  const all = ['approve', 'reject', 'promote'];
  it('approval_allowed=false esconde Aprovar e Promover, mantém Rejeitar', () => {
    expect(visibleReviewActions(all, sum({ approval_allowed: false }))).toEqual(['reject']);
  });
  it('approval_allowed=true ou produto sem auditoria → sem alteração', () => {
    expect(visibleReviewActions(all, sum({ approval_allowed: true }))).toEqual(all);
    expect(visibleReviewActions(all, null)).toEqual(all);
  });
});

describe('filtro', () => {
  it.each([['unclear', 'unclear'], ['not_audited', 'not_audited'], ['approved', undefined], [undefined, undefined]])(
    '%j → %j', (raw, exp) => { expect(parseFilterParam(raw as string | undefined)).toBe(exp); },
  );
});
