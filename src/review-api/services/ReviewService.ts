import type { VenueReviewRepository, VenueListQuery } from '../repositories/VenueReviewRepository';
import type { ActivityReviewRepository, ActivityListQuery } from '../repositories/ActivityReviewRepository';
import type { ReviewAction, AuthUser, VenueStagingRow, VenueStagingDetail, ActivityStagingRow } from '../types/reviewTypes';
import type { ListResponse } from '../types/listTypes';
import { ACTION_ROLES } from '../types/reviewTypes';
import { ELIGIBILITY_BLOCKED_CODE, type EligibilityAuditIndex, type EligibilityFilter, type EligibilitySummary } from '../eligibility/eligibilityAudit';
import type { IEligibilityReviewRepository } from '../repositories/EligibilityReviewRepository';
import {
  humanReviewState, parseEligibilityReviewInput, summarizeReview,
  type EligibilityReviewRow,
} from '../eligibility/humanReview';

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
  /** Revisões humanas (0033). Ausente → só o dataset auditado (comportamento anterior). */
  reviews?: IEligibilityReviewRepository;
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

  /**
   * Classificação efectiva: a última revisão humana VÁLIDA (mesma chave, não
   * expirada) prevalece sobre o dataset auditado; senão, o dataset.
   * Produtos sem auditoria (base null) ficam iguais.
   */
  private effective(a: ActivityStagingRow, base: EligibilitySummary | null, review: EligibilityReviewRow | undefined): EligibilitySummary | null {
    if (!base) return null;
    const fromDataset = base.status === 'matched' ? 'audit_dataset' as const : 'none' as const;
    if (!review) return { ...base, review_source: fromDataset, human_review: null };
    const key = keyOf(a);
    const valid = humanReviewState(review, key) === 'valid';
    if (!valid) return { ...base, review_source: fromDataset, human_review: summarizeReview(review, key) };
    return {
      ...base,
      classification: review.classification,
      confidence: review.confidence,
      availability: review.availability,
      approval_allowed: review.classification === 'confirmed_60plus',
      needs_human_review: false,
      review_source: 'human_review',
      human_review: summarizeReview(review, key),
    };
  }

  /** Guarda do servidor para approve/promote, com revisões humanas. */
  private async approvalAllowedFor(a: ActivityStagingRow): Promise<boolean> {
    const el = this.eligibility!;
    if (!el.index.covers(a.product_key)) return true;
    const latest = el.reviews ? (await el.reviews.listByActivity(a.id))[0] : undefined;
    if (latest && humanReviewState(latest, keyOf(a)) === 'valid') return latest.classification === 'confirmed_60plus';
    return el.index.approvalAllowed(keyOf(a));
  }

  async listEligibilityReviews(id: string): Promise<EligibilityReviewRow[]> {
    const activity = await this.activityRepo.getById(id);
    if (!activity) throw new NotFoundError(`Activity ${id} não encontrada`);
    const el = this.eligibility;
    if (!el?.reviews || !el.index.covers(activity.product_key)) throw new InvalidQueryError('Revisão de elegibilidade indisponível para este produto');
    return el.reviews.listByActivity(id);
  }

  /** Regista uma classificação fundamentada (não muda proposal_status). */
  async submitEligibilityReview(id: string, body: unknown, user: AuthUser): Promise<EligibilityReviewRow> {
    this.assertRole('approve', user); // mesmos papéis que aprovam: reviewer, admin
    const activity = await this.activityRepo.getById(id);
    if (!activity) throw new NotFoundError(`Activity ${id} não encontrada`);
    const el = this.eligibility;
    if (!el?.reviews || !el.index.covers(activity.product_key)) throw new InvalidQueryError('Revisão de elegibilidade indisponível para este produto');
    if (!activity.source_key || !activity.source_item_id) throw new InvalidQueryError('Actividade sem chave de fonte: não pode ser revista');
    const input = parseEligibilityReviewInput(body);
    return el.reviews.insert({
      ...input,
      activity_staging_id: activity.id,
      product_key: activity.product_key,
      source_key: activity.source_key,
      source_item_id: activity.source_item_id,
      external_url: activity.external_url ?? null,
      reviewed_by: user.id,
      reviewed_role: user.role === 'admin' ? 'admin' : 'reviewer',
    });
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
    const latest = el.reviews ? await el.reviews.latestByActivityIds(result.items.filter(a => el.index.covers(a.product_key)).map(a => a.id)) : new Map();
    return { ...result, items: result.items.map(a => ({ ...a, eligibility: this.effective(a, el.index.summary(keyOf(a)), latest.get(a.id)) })) };
  }

  async getActivity(id: string): Promise<ActivityStagingRow> {
    const activity = await this.activityRepo.getById(id);
    if (!activity) throw new NotFoundError(`Activity ${id} não encontrada`);
    const el = this.eligibility;
    if (!el?.expose) return activity;
    const detail = el.index.detail(keyOf(activity));
    const latest = detail && el.reviews ? (await el.reviews.listByActivity(activity.id))[0] : undefined;
    const eff = this.effective(activity, detail, latest);
    return { ...activity, eligibility: detail && eff ? { ...detail, ...eff } : null };
  }

  async reviewActivity(id: string, action: ReviewAction, user: AuthUser): Promise<void> {
    this.assertRole(action, user);
    const activity = await this.activityRepo.getById(id);
    if (!activity) throw new NotFoundError(`Activity ${id} não encontrada`);
    // Issue #62: guarda no servidor (não só na UI). Num produto auditado, só
    // confirmed_60plus pode ser aprovada/promovida; sem correspondência → recusa.
    if ((action === 'approve' || action === 'promote') && this.eligibility
        && !(await this.approvalAllowedFor(activity))) {
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
