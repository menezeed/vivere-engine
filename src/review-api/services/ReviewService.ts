import type { VenueReviewRepository, VenueListQuery } from '../repositories/VenueReviewRepository';
import type { ActivityReviewRepository, ActivityListQuery } from '../repositories/ActivityReviewRepository';
import type { ReviewAction, AuthUser, VenueStagingRow, VenueStagingDetail, ActivityStagingRow } from '../types/reviewTypes';
import type { ListResponse } from '../types/listTypes';
import { ACTION_ROLES } from '../types/reviewTypes';

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) { super(message); this.name = 'NotFoundError'; }
}

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message: string) { super(message); this.name = 'ForbiddenError'; }
}

export class ReviewService {
  constructor(
    private readonly venueRepo: VenueReviewRepository,
    private readonly activityRepo: ActivityReviewRepository,
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

  async listActivities(query: ActivityListQuery): Promise<ListResponse<ActivityStagingRow>> {
    return this.activityRepo.list(query);
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

  private assertRole(action: ReviewAction, user: AuthUser): void {
    const allowed = ACTION_ROLES[action];
    if (!allowed.includes(user.role)) {
      throw new ForbiddenError(`Role '${user.role}' não tem permissão para '${action}'`);
    }
  }
}
