/**
 * Issue #62 — ReviewService com a auditoria de elegibilidade: blocos na
 * resposta, filtro no servidor e guarda de approve/promote (não só na UI).
 */
import { describe, it, expect, vi } from 'vitest';
import { ReviewService, ForbiddenError, InvalidQueryError, EligibilityBlockedError } from '../ReviewService';
import { loadEligibilityIndex } from '../../eligibility/eligibilityAudit';
import type { ActivityStagingRow, AuthUser } from '../../types/reviewTypes';
import type { ActivityReviewRepository } from '../../repositories/ActivityReviewRepository';
import type { VenueReviewRepository } from '../../repositories/VenueReviewRepository';

const index = loadEligibilityIndex();
const UK = 'vivere-60-plus-uk-test';
const admin: AuthUser = { id: 'u1', email: 'a@example.test', role: 'admin' };

function row(over: Partial<ActivityStagingRow>): ActivityStagingRow {
  return {
    id: '00000000-0000-4000-8000-000000000001', raw_activity_item_id: 'r', product_key: UK,
    proposal_status: 'pending_review', venue_resolution_status: 'unresolved',
    reviewed_by: null, reviewed_at: null, promoted_at: null, promoted_activity_id: null,
    created_at: '2026-11-26T00:00:00Z', source_key: 'u3a_richmond', ...over,
  } as ActivityStagingRow;
}
const SEATED = row({ source_item_id: 'group:270', external_url: 'https://rut.u3asite.uk/u3a_groups/extend-exercise/' });
const ARCH = row({ source_item_id: 'group:194', external_url: 'https://rut.u3asite.uk/u3a_groups/architecture-modern/' });
const NEW_GROUP = row({ source_item_id: 'group:187', external_url: 'https://rut.u3asite.uk/u3a_groups/could-you-start-a-new-group/' });
const BR = row({ product_key: 'vivere-60-mais', source_key: 'wp', source_item_id: 'post:1', external_url: 'https://x' });

function make(current: ActivityStagingRow, expose = true) {
  const repo = {
    list: vi.fn(async () => ({ items: [SEATED, ARCH], page: 1, pageSize: 20, totalItems: 2, totalPages: 1 })),
    getById: vi.fn(async () => current),
    updateStatus: vi.fn(async () => undefined),
    markPromoted: vi.fn(async () => undefined),
  };
  const svc = new ReviewService({} as VenueReviewRepository, repo as unknown as ActivityReviewRepository, { index, expose });
  return { svc, repo };
}

describe('listActivities', () => {
  it('anexa o resumo de elegibilidade a cada linha', async () => {
    const { svc } = make(SEATED);
    const res = await svc.listActivities({ product_key: UK });
    expect(res.items.map(i => i.eligibility)).toEqual([
      { status: 'matched', classification: 'confirmed_60plus', confidence: 'high', availability: 'waiting_list', approval_allowed: true, needs_human_review: true },
      { status: 'matched', classification: 'likely_suitable', confidence: 'medium', availability: 'waiting_list', approval_allowed: false, needs_human_review: false },
    ]);
  });

  it('filtro → o repositório recebe os source_item_ids (paginação no servidor)', async () => {
    const { svc, repo } = make(SEATED);
    await svc.listActivities({ product_key: UK, page: 2, pageSize: 20, eligibility: ['confirmed_60plus'] });
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({
      page: 2, pageSize: 20, source_item_ids: { mode: 'in', ids: ['group:270'] },
    }));
  });

  it('filtro num produto sem auditoria → 400', async () => {
    const { svc } = make(SEATED);
    await expect(svc.listActivities({ product_key: 'vivere-60-mais', eligibility: ['unclear'] }))
      .rejects.toBeInstanceOf(InvalidQueryError);
  });

  it('flag desligada: sem blocos e filtro recusado', async () => {
    const { svc } = make(SEATED, false);
    const res = await svc.listActivities({ product_key: UK });
    expect(res.items.every(i => i.eligibility === undefined)).toBe(true);
    await expect(svc.listActivities({ product_key: UK, eligibility: ['unclear'] })).rejects.toBeInstanceOf(InvalidQueryError);
  });
});

describe('getActivity', () => {
  it('detalhe com registo, quota e aviso', async () => {
    const { svc } = make(ARCH);
    const a = await svc.getActivity(ARCH.id);
    const e = a.eligibility as { record: { evidence: string }; membership: unknown; notice: string; approval_allowed: boolean };
    expect(e.record.evidence).toMatch(/co-operative of older people/);
    expect(e.membership).not.toBeNull();
    expect(e.notice).toMatch(/não é aprovação nem publicação/);
    expect(e.approval_allowed).toBe(false);
  });
});

describe('reviewActivity — guarda no servidor', () => {
  it.each(['approve', 'promote'] as const)('%s de likely_suitable → 403 e nada é escrito', async (action) => {
    const { svc, repo } = make(ARCH);
    await expect(svc.reviewActivity(ARCH.id, action, admin)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(repo.markPromoted).not.toHaveBeenCalled();
  });

  it('o 403 da guarda é EligibilityBlockedError (subclasse de ForbiddenError) com código próprio', async () => {
    const { svc } = make(ARCH);
    const err = await svc.reviewActivity(ARCH.id, 'approve', admin).catch(e => e);
    expect(err).toBeInstanceOf(EligibilityBlockedError);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.code).toBe('ELIGIBILITY_NOT_CONFIRMED');
  });

  it('RBAC continua primeiro: viewer recebe ForbiddenError sem código de elegibilidade', async () => {
    const { svc } = make(ARCH);
    const err = await svc.reviewActivity(ARCH.id, 'approve', { ...admin, role: 'viewer' }).catch(e => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err).not.toBeInstanceOf(EligibilityBlockedError);
  });

  it('approve de unsuitable → 403', async () => {
    const { svc } = make(NEW_GROUP);
    await expect(svc.reviewActivity(NEW_GROUP.id, 'approve', admin)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('URL divergente (cruzamento incorrecto) → 403', async () => {
    const bad = { ...SEATED, external_url: 'https://rut.u3asite.uk/u3a_groups/architecture-modern/' };
    const { svc, repo } = make(bad);
    await expect(svc.reviewActivity(bad.id, 'approve', admin)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('a guarda continua activa com a flag desligada', async () => {
    const { svc } = make(ARCH, false);
    await expect(svc.reviewActivity(ARCH.id, 'approve', admin)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('reject continua permitido (RBAC normal)', async () => {
    const { svc, repo } = make(ARCH);
    await svc.reviewActivity(ARCH.id, 'reject', admin);
    expect(repo.updateStatus).toHaveBeenCalledOnce();
  });

  it('confirmed_60plus e produto BR seguem o fluxo normal', async () => {
    for (const a of [SEATED, BR]) {
      const { svc, repo } = make(a);
      await svc.reviewActivity(a.id, 'approve', admin);
      expect(repo.updateStatus).toHaveBeenCalledOnce();
    }
  });
});
