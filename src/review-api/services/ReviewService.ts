import type { VenueReviewRepository, VenueListQuery } from '../repositories/VenueReviewRepository';
import type { ActivityReviewRepository, ActivityListQuery } from '../repositories/ActivityReviewRepository';
import type { ReviewAction, AuthUser, VenueStagingRow, VenueStagingDetail, ActivityStagingRow } from '../types/reviewTypes';
import type { ListResponse } from '../types/listTypes';
import { ACTION_ROLES } from '../types/reviewTypes';
import { ELIGIBILITY_BLOCKED_CODE, type EligibilityAuditIndex, type EligibilityFilter } from '../eligibility/eligibilityAudit';

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) { super(message); this.name = 'NotFoundError'; }
}

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message: string) { super(message); this.name = 'ForbiddenError'; }
}

/**
 * 403 da guarda de elegibilidade (Issue #62). Continua a ser 403 (ForbiddenError),
 * mas com um código próprio: a UI distingue-o de "falta de papel" (RBAC).
 */
export class EligibilityBlockedError extends ForbiddenError {
  readonly code = ELIGIBILITY_BLOCKED_CODE;
  constructor(message: string) { super(message); this.name = 'EligibilityBlockedError'; }
}

/** Pedido inválido para o contexto (ex.: filtro de elegibilidade num produto sem auditoria). */
export class InvalidQueryError extends Error {
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = 'InvalidQueryError'; }
}

/**
 * Issue #62: auditoria de elegibilidade 60+.
 * - index: dados auditados (só leitura). Sem index → comportamento anterior.
 * - expose: flag REVIEW_API_ELIGIBILITY_AUDIT (blocos + filtro na resposta).
 * A guarda de approve/promote usa o index mesmo com expose=false.
 */
export interface EligibilityOptions {
  index: EligibilityAuditIndex;
  expose: boolean;
}

export type ActivityListRequest = ActivityListQuery & { eligibility?: EligibilityFilter[] };

const keyOf = (a: ActivityStagingRow) => ({
  product_key: a.product_key, source_key: a.source_key ?? null,
  source_item_id: a.source_item_id ?? null, external_url: a.external_url ?? null,
});

export class ReviewService {
  constructor(
    private readonly venueRepo: VenueReviewRepository,
    private readonly activityRepo: ActivityReviewRepository,
    private readonly eligibility?: EligibilityOptions,
  ) {}

  async listVenues(query: VenueListQuery): Promise<ListResponse<VenueStagingRow>> {
    return this.venueRepo.list(query);
  }

  async getVenue(id: string): Promise<VenueStagingDetail> {
    const venue = await this.venueRepo.getById(id);
    if (!venue) throw new NotFoundError(`Venue ${id} não encontrado`);
    return venue;
  }

  async reviewVenue(id: string, action: ReviewAction, user: AuthUser): Promise<void> {
    this.assertRole(action, user);
    const venue = await this.venueRepo.getById(id);
    if (!venue) throw new NotFoundError(`Venue ${id} não encontrado`);
    if (action === 'promote') {
      await this.venueRepo.markPromoted(id, user.id);
    } else {
      await this.venueRepo.updateStatus(id, { action, reviewedBy: user.id });
    }
  }

  async listActivities(request: ActivityListRequest): Promise<ListResponse<ActivityStagingRow>> {
    const { eligibility: filter, ...query } = request;
    const el = this.eligibility;
    if (filter) {
      if (!el?.expose) throw new InvalidQueryError('Filtro de elegibilidade indisponível (desligado)');
      const ids = query.product_key ? el.index.filterIds(query.product_key, filter) : null;
      if (!ids) throw new InvalidQueryError('Filtro de elegibilidade só existe para produtos com auditoria');
      query.source_item_ids = ids;
    }
    const result = await this.activityRepo.list(query);
    if (!el?.expose) return result;
    return { ...result, items: result.items.map(a => ({ ...a, eligibility: el.index.summary(keyOf(a)) })) };
  }

  async getActivity(id: string): Promise<ActivityStagingRow> {
    const activity = await this.activityRepo.getById(id);
    if (!activity) throw new NotFoundError(`Activity ${id} não encontrada`);
    const el = this.eligibility;
    if (!el?.expose) return activity;
    return { ...activity, eligibility: el.index.detail(keyOf(activity)) };
  }

  async reviewActivity(id: string, action: ReviewAction, user: AuthUser): Promise<void> {
    this.assertRole(action, user);
    const activity = await this.activityRepo.getById(id);
    if (!activity) throw new NotFoundError(`Activity ${id} não encontrada`);
    // Issue #62: guarda no servidor (não só na UI). Num produto auditado, só
    // confirmed_60plus pode ser aprovada/promovida; sem correspondência → recusa.
    if ((action === 'approve' || action === 'promote') && this.eligibility
        && !this.eligibility.index.approvalAllowed(keyOf(activity))) {
      throw new EligibilityBlockedError(`'${action}' bloqueado: a elegibilidade 60+ desta actividade não está confirmada`);
    }
    if (action === 'promote') {
      await this.activityRepo.markPromoted(id, user.id);
    } else {
      await this.activityRepo.updateStatus(id, { action, reviewedBy: user.id });
    }
  }

  private assertRole(action: ReviewAction, user: AuthUser): void {
    const allowed = ACTION_ROLES[action];
    if (!allowed.includes(user.role)) {
      throw new ForbiddenError(`Role '${user.role}' não tem permissão para '${action}'`);
    }
  }
}
