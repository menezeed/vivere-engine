import type { IVenueReviewRepository, IActivityReviewRepository } from '../../persistence/types/repositoryInterfaces';
import type {
  ReviewFilter,
  ReviewAction,
  AuthUser,
  VenueStagingRow,
  ActivityStagingRow,
} from '../types/reviewTypes';
import { ACTION_ROLES } from '../types/reviewTypes';

/**
 * ReviewService — orquestra ações de revisão humana.
 *
 * Responsabilidades:
 * - Validar que o usuário tem a role necessária para a ação
 * - Delegar a transição de status ao repositório correto
 * - Nunca escrever diretamente no banco (delegação total)
 *
 * Não conhece HTTP, não conhece Supabase diretamente — depende
 * apenas das interfaces de repositório.
 */
export class ReviewService {
  constructor(
    private readonly venueRepo: IVenueReviewRepository,
    private readonly activityRepo: IActivityReviewRepository,
  ) {}

  // ─── Venues ──────────────────────────────────────────────

  async listVenues(filter: ReviewFilter): Promise<VenueStagingRow[]> {
    return this.venueRepo.list(filter);
  }

  async getVenue(id: string): Promise<VenueStagingRow> {
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

  // ─── Activities ──────────────────────────────────────────

  async listActivities(filter: ReviewFilter): Promise<ActivityStagingRow[]> {
    return this.activityRepo.list(filter);
  }

  async getActivity(id: string): Promise<ActivityStagingRow> {
    const activity = await this.activityRepo.getById(id);
    if (!activity) throw new NotFoundError(`Activity ${id} não encontrada`);
    return activity;
  }

  async reviewActivity(id: string, action: ReviewAction, user: AuthUser): Promise<void> {
    this.assertRole(action, user);

    const activity = await this.activityRepo.getById(id);
    if (!activity) throw new NotFoundError(`Activity ${id} não encontrada`);

    if (action === 'promote') {
      await this.activityRepo.markPromoted(id, user.id);
    } else {
      await this.activityRepo.updateStatus(id, { action, reviewedBy: user.id });
    }
  }

  // ─── Privado ─────────────────────────────────────────────

  private assertRole(action: ReviewAction, user: AuthUser): void {
    const allowed = ACTION_ROLES[action];
    if (!allowed.includes(user.role)) {
      throw new ForbiddenError(
        `Role '${user.role}' não tem permissão para '${action}'. Roles permitidas: ${allowed.join(', ')}`,
      );
    }
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) { super(message); this.name = 'NotFoundError'; }
}

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message: string) { super(message); this.name = 'ForbiddenError'; }
}
