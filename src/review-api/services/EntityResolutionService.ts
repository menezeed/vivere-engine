/**
 * src/review-api/services/EntityResolutionService.ts
 *
 * Regras de negócio para revisão humana de Entity Resolution.
 * Mesmo padrão do ReviewService — routes finas, service com lógica.
 */

import type { EntityResolutionReviewRepository } from '../repositories/EntityResolutionReviewRepository.js';
import type { AuthUser } from '../types/reviewTypes.js';
import type { ListResponse } from '../types/listTypes.js';
import type { ERQueueItem, ERCandidate, ERStats } from '../repositories/EntityResolutionReviewRepository.js';
import { NotFoundError, ForbiddenError } from './ReviewService.js';

// ── RBAC para ER ─────────────────────────────────────────────────────────────

const ER_ACTION_ROLES = {
  accept:      ['reviewer', 'admin'],
  override:    ['reviewer', 'admin'],
  proposeNew:  ['admin'],
} as const;

type ERAction = keyof typeof ER_ACTION_ROLES;

// ── Service ───────────────────────────────────────────────────────────────────

export class EntityResolutionService {
  constructor(
    private readonly erRepo: EntityResolutionReviewRepository,
  ) {}

  // ── Fila ──────────────────────────────────────────────────────────────────

  async listQueue(
    productKey: string,
    status:     string | undefined,
    page:       number,
    pageSize:   number,
  ): Promise<ListResponse<ERQueueItem>> {
    if (!productKey) throw new Error('product_key é obrigatório');
    return this.erRepo.listQueue({ product_key: productKey, status, page, pageSize });
  }

  // ── Candidatos ─────────────────────────────────────────────────────────────

  async listCandidates(activityId: string): Promise<ERCandidate[]> {
    const candidates = await this.erRepo.listCandidates(activityId);
    if (candidates.length === 0) {
      // Pode não ter candidatos — actividade sem mention ou proposed_new
      return [];
    }
    return candidates;
  }

  // ── Accept ─────────────────────────────────────────────────────────────────

  async accept(
    activityId:  string,
    candidateId: string,
    user:        AuthUser,
    notes:       string | null,
  ): Promise<void> {
    this.assertRole('accept', user);

    if (!candidateId) throw new Error('candidateId é obrigatório para accept');

    // Verificar se já tem decisão
    await this.assertNoPriorDecision(activityId);

    // overrodeHighConfidence: true se o revisor aceita candidato que o motor
    // já classificou como matched (confirmação explícita de override)
    const candidates = await this.erRepo.listCandidates(activityId);
    const candidate  = candidates.find(c => c.id === candidateId);
    if (!candidate) {
      throw new NotFoundError(`Candidato ${candidateId} não encontrado`);
    }
    const overrode = candidate.autoClassification === 'matched' &&
                     candidates[0]?.id !== candidateId;

    await this.erRepo.recordAccept(activityId, candidateId, user.id, notes, overrode);
  }

  // ── Override (escolher candidato diferente do sugerido) ────────────────────

  async override(
    activityId:  string,
    candidateId: string,
    user:        AuthUser,
    notes:       string,
  ): Promise<void> {
    this.assertRole('override', user);

    if (!candidateId) throw new Error('candidateId é obrigatório para override');
    if (!notes?.trim()) throw new Error('notes é obrigatório para override');

    await this.assertNoPriorDecision(activityId);

    // Override é o mesmo mecanismo de accept — a distinção é semântica
    // (o revisor escolheu um candidato diferente do top sugerido)
    const candidates = await this.erRepo.listCandidates(activityId);
    const candidate  = candidates.find(c => c.id === candidateId);
    if (!candidate) {
      throw new NotFoundError(`Candidato ${candidateId} não encontrado`);
    }

    // overrodeHighConfidence = true quando o motor já tinha um matched diferente
    const topIsMatched = candidates[0]?.autoClassification === 'matched';
    const choseDifferent = candidates[0]?.id !== candidateId;
    const overrode = topIsMatched && choseDifferent;

    await this.erRepo.recordAccept(activityId, candidateId, user.id, notes, overrode);
  }

  // ── Propose-new ─────────────────────────────────────────────────────────────

  async proposeNew(
    activityId: string,
    user:       AuthUser,
    notes:      string | null,
  ): Promise<void> {
    this.assertRole('proposeNew', user);
    await this.assertNoPriorDecision(activityId);
    await this.erRepo.recordProposeNew(activityId, user.id, notes);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  async getHealth(productKey: string) {
    if (!productKey) throw new Error('product_key é obrigatório');
    return this.erRepo.getHealth(productKey);
  }

  async getStats(productKey: string): Promise<ERStats> {
    if (!productKey) throw new Error('product_key é obrigatório');
    return this.erRepo.getStats(productKey);
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  private assertRole(action: ERAction, user: AuthUser): void {
    const allowed = ER_ACTION_ROLES[action] as readonly string[];
    if (!allowed.includes(user.role)) {
      throw new ForbiddenError(
        `Acção '${action}' requer role ${allowed.join(' ou ')} — utilizador tem role '${user.role}'`,
      );
    }
  }

  private async assertNoPriorDecision(activityId: string): Promise<void> {
    // Verificar se já existe decisão — protege contra dupla submissão
    // O repositório vai falhar na FK constraint, mas melhor falhar cedo com mensagem clara
    const candidates = await this.erRepo.listCandidates(activityId);
    const hasDecision = candidates.some(c => c.decisionOutcome !== null);
    if (hasDecision) {
      throw new ForbiddenError(
        `Actividade ${activityId} já tem uma decisão registada. ` +
        `Para alterar, o Admin deve limpar a decisão anterior primeiro.`,
      );
    }
  }
}
