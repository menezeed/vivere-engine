/**
 * Issue #62 — revisão humana de elegibilidade 60+: validação, regra de
 * aprovação no servidor e integração no ReviewService. Sem rede nem BD.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseEligibilityReviewInput, humanReviewState, humanReviewAllowsApproval, isHumanReviewEnabled,
  ReviewValidationError, type EligibilityReviewRow,
} from '../humanReview';
import { loadEligibilityIndex } from '../eligibilityAudit';
import { UK_PILOT_PRODUCT } from '../../../collectors/u3a-siteworks/config';
import { ReviewService, EligibilityBlockedError, ForbiddenError, InvalidQueryError } from '../../services/ReviewService';
import type { ActivityStagingRow, AuthUser } from '../../types/reviewTypes';
import type { ActivityReviewRepository } from '../../repositories/ActivityReviewRepository';
import type { VenueReviewRepository } from '../../repositories/VenueReviewRepository';
import type { IEligibilityReviewRepository } from '../../repositories/EligibilityReviewRepository';

const NOW = new Date('2026-11-27T10:00:00Z');
const VALID = {
  classification: 'confirmed_60plus', confidence: 'medium', availability: 'open',
  evidence_text: 'A página oficial diz "specially designed for people aged over 60".',
  evidence_url: 'https://greenwoodcommunity.org.uk/activities/', verified_at: '2026-11-26',
  audience: 'Pessoas com mais de 60 anos', membership_required: null, booking: 'Contactar o organizador',
  additional_costs: null, notes: null,
};

describe('parseEligibilityReviewInput', () => {
  it('aceita uma revisão completa', () => {
    expect(parseEligibilityReviewInput(VALID, NOW)).toMatchObject({ classification: 'confirmed_60plus', verified_at: '2026-11-26' });
  });
  it.each([
    ['classificação desconhecida', { classification: 'approved' }, /classification/],
    ['evidência curta', { evidence_text: 'curta' }, /evidence_text/],
    ['URL http', { evidence_url: 'http://x.org/abc' }, /https/],
    ['data no futuro', { verified_at: '2026-12-31' }, /futuro/],
    ['data inválida', { verified_at: '26/11/2026' }, /AAAA-MM-DD/],
    ['confirmed com verificação antiga', { verified_at: '2026-01-01' }, /180 dias/],
    ['confirmed com confiança baixa', { confidence: 'low' }, /confiança baixa/],
    ['telefone na evidência', { evidence_text: 'Ligar para 020 8876 0000 para confirmar a idade mínima.' }, /telefones/],
    ['e-mail no público', { audience: 'x@y.org' }, /e-mails/],
    ['disponibilidade inválida', { availability: 'full' }, /availability/],
    ['membership não booleano', { membership_required: 'sim' }, /membership_required/],
  ])('%s → 400', (_n, patch, re) => {
    try { parseEligibilityReviewInput({ ...VALID, ...patch }, NOW); throw new Error('não falhou'); }
    catch (e) { expect(e).toBeInstanceOf(ReviewValidationError); expect((e as Error).message).toMatch(re); }
  });
  it('unsuitable pode ter verificação antiga (até 365 dias) e confiança baixa', () => {
    expect(() => parseEligibilityReviewInput({ ...VALID, classification: 'unsuitable', confidence: 'low', verified_at: '2026-03-01' }, NOW)).not.toThrow();
  });
  it('a opção está desligada por omissão', () => {
    expect(isHumanReviewEnabled({})).toBe(false);
    expect(isHumanReviewEnabled({ REVIEW_API_ELIGIBILITY_REVIEWS: 'on' })).toBe(true);
  });
});

const PRODUCT = UK_PILOT_PRODUCT;
const SOURCE = 'greenwood_hhhvc';
const KEY = { product_key: PRODUCT, source_key: SOURCE, source_item_id: 'series:flexercise-over-60s:thu:1415', external_url: 'https://greenwoodcommunity.org.uk/activities/' };
const ACT_ID = '00000000-0000-4000-8000-0000000000c1';
function review(over: Partial<EligibilityReviewRow> = {}): EligibilityReviewRow {
  return { ...(VALID as unknown as EligibilityReviewRow), id: 'r1', activity_staging_id: ACT_ID, ...KEY,
    reviewed_by: 'u-rev', reviewed_role: 'reviewer', reviewed_at: '2026-11-26T12:00:00Z', ...over };
}

describe('regra de aprovação', () => {
  it('válida e confirmed_60plus → permite', () => {
    expect(humanReviewState(review(), KEY, NOW)).toBe('valid');
    expect(humanReviewAllowsApproval(review(), KEY, NOW)).toBe(true);
  });
  it('outra classificação → não permite', () => {
    expect(humanReviewAllowsApproval(review({ classification: 'likely_suitable' }), KEY, NOW)).toBe(false);
  });
  it('chave mudou (URL) → obsoleta, não permite', () => {
    expect(humanReviewState(review(), { ...KEY, external_url: 'https://greenwoodcommunity.org.uk/other/' }, NOW)).toBe('stale_key');
    expect(humanReviewAllowsApproval(review(), { ...KEY, external_url: null }, NOW)).toBe(false);
  });
  it('verificação com mais de 180 dias → expirada', () => {
    expect(humanReviewState(review({ verified_at: '2026-05-01' }), KEY, new Date('2026-11-27T00:00:00Z'))).toBe('expired');
  });
});

// ── ReviewService ───────────────────────────────────────────────────────────

const index = loadEligibilityIndex();
const reviewer: AuthUser = { id: 'u-rev', email: 'r@example.test', role: 'reviewer' };
const viewer: AuthUser = { id: 'u-v', email: 'v@example.test', role: 'viewer' };
const GREENWOOD = {
  id: ACT_ID, raw_activity_item_id: 'raw', product_key: KEY.product_key, proposal_status: 'pending_review',
  venue_resolution_status: 'unresolved', reviewed_by: null, reviewed_at: null, promoted_at: null, promoted_activity_id: null,
  created_at: '2026-11-26T00:00:00Z', source_key: KEY.source_key, source_item_id: KEY.source_item_id, external_url: KEY.external_url,
} as ActivityStagingRow;

function make(history: EligibilityReviewRow[], current: ActivityStagingRow = GREENWOOD) {
  const repo = {
    list: vi.fn(async () => ({ items: [current], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 })),
    getById: vi.fn(async () => current),
    updateStatus: vi.fn(async () => undefined),
    markPromoted: vi.fn(async () => undefined),
  };
  const reviews: IEligibilityReviewRepository = {
    listByActivity: vi.fn(async () => history),
    latestByActivityIds: vi.fn(async () => new Map(history.length ? [[ACT_ID, history[0]!]] : [])),
    insert: vi.fn(async (r) => ({ ...r, id: 'new', reviewed_at: '2026-11-27T10:00:00Z' } as EligibilityReviewRow)),
  };
  const svc = new ReviewService({} as VenueReviewRepository, repo as unknown as ActivityReviewRepository, { index, expose: true, reviews });
  return { svc, repo, reviews };
}

describe('ReviewService + revisão humana', () => {
  it('sem revisão: actividade nova fica "Sem auditoria" e approve é recusado (403 com code)', async () => {
    const { svc, repo } = make([]);
    const list = await svc.listActivities({ product_key: KEY.product_key });
    expect(list.items[0]!.eligibility).toMatchObject({ status: 'not_audited', classification: null, approval_allowed: false, review_source: 'none' });
    await expect(svc.reviewActivity(ACT_ID, 'approve', reviewer)).rejects.toBeInstanceOf(EligibilityBlockedError);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('revisão válida confirmed_60plus: classificação efectiva e approve aceite', async () => {
    const { svc, repo } = make([review()]);
    const d = await svc.getActivity(ACT_ID);
    expect(d.eligibility).toMatchObject({ classification: 'confirmed_60plus', approval_allowed: true, review_source: 'human_review' });
    await svc.reviewActivity(ACT_ID, 'approve', reviewer);
    expect(repo.updateStatus).toHaveBeenCalledWith(ACT_ID, { action: 'approve', reviewedBy: 'u-rev' });
  });

  it('revisão "unsuitable" mais recente prevalece: approve recusado e distinto de "Sem auditoria"', async () => {
    const { svc } = make([review({ id: 'r2', classification: 'unsuitable', confidence: 'medium' }), review()]);
    const d = await svc.getActivity(ACT_ID);
    expect(d.eligibility).toMatchObject({ classification: 'unsuitable', review_source: 'human_review', approval_allowed: false });
    await expect(svc.reviewActivity(ACT_ID, 'approve', reviewer)).rejects.toBeInstanceOf(EligibilityBlockedError);
  });

  it('revisão obsoleta (URL mudou) não conta: volta ao dataset (sem auditoria) e mostra o estado', async () => {
    const { svc } = make([review({ external_url: 'https://greenwoodcommunity.org.uk/old/' })]);
    const d = await svc.getActivity(ACT_ID);
    expect(d.eligibility).toMatchObject({ review_source: 'none', approval_allowed: false, human_review: { state: 'stale_key' } });
    await expect(svc.reviewActivity(ACT_ID, 'approve', reviewer)).rejects.toBeInstanceOf(EligibilityBlockedError);
  });

  it('registar revisão: guarda a chave da actividade e o revisor; não muda proposal_status', async () => {
    const { svc, repo, reviews } = make([]);
    await svc.submitEligibilityReview(ACT_ID, VALID, reviewer);
    expect(reviews.insert).toHaveBeenCalledWith(expect.objectContaining({
      activity_staging_id: ACT_ID, ...KEY, reviewed_by: 'u-rev', reviewed_role: 'reviewer', classification: 'confirmed_60plus',
    }));
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(repo.markPromoted).not.toHaveBeenCalled();
  });

  it('viewer não pode registar revisão (RBAC também no serviço)', async () => {
    const { svc, reviews } = make([]);
    await expect(svc.submitEligibilityReview(ACT_ID, VALID, viewer)).rejects.toBeInstanceOf(ForbiddenError);
    expect(reviews.insert).not.toHaveBeenCalled();
  });

  it('produto sem auditoria (BR) → 400, nada gravado', async () => {
    const { svc, reviews } = make([], { ...GREENWOOD, product_key: 'vivere-60-mais' });
    await expect(svc.submitEligibilityReview(ACT_ID, VALID, reviewer)).rejects.toBeInstanceOf(InvalidQueryError);
    expect(reviews.insert).not.toHaveBeenCalled();
  });

  it('sem repositório de revisões (opção desligada): comportamento anterior, sem consultas', async () => {
    const repo = { list: vi.fn(async () => ({ items: [GREENWOOD], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 })), getById: vi.fn(async () => GREENWOOD) };
    const svc = new ReviewService({} as VenueReviewRepository, repo as unknown as ActivityReviewRepository, { index, expose: true });
    const list = await svc.listActivities({ product_key: KEY.product_key });
    expect(list.items[0]!.eligibility).toMatchObject({ status: 'not_audited', review_source: 'none' });
    await expect(svc.submitEligibilityReview(ACT_ID, VALID, reviewer)).rejects.toBeInstanceOf(InvalidQueryError);
  });
});
