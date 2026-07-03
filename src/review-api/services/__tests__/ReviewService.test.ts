import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewService, NotFoundError, ForbiddenError } from '../ReviewService';
import type { IVenueReviewRepository, IActivityReviewRepository } from '../../../persistence/types/repositoryInterfaces';
import type { VenueStagingRow, ActivityStagingRow, AuthUser } from '../../types/reviewTypes';

function makeVenueRow(overrides: Partial<VenueStagingRow> = {}): VenueStagingRow {
  return {
    id: 'venue-staging-uuid',
    raw_venue_item_id: 'raw-uuid',
    source_key: 'google_places',
    source_item_id: 'ChIJ_test',
    product_key: 'vivere-60-mais',
    proposal_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    promoted_at: null,
    promoted_venue_id: null,
    created_at: '2026-07-03T00:00:00Z',
    ...overrides,
  };
}

function makeUser(role: AuthUser['role']): AuthUser {
  return { id: 'user-uuid', email: 'test@vivere.com', role };
}

function makeVenueRepo(row: VenueStagingRow | null = makeVenueRow()): {
  repo: IVenueReviewRepository;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  const mocks = {
    list:         vi.fn().mockResolvedValue(row ? [row] : []),
    getById:      vi.fn().mockResolvedValue(row),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    markPromoted: vi.fn().mockResolvedValue(undefined),
  };
  return { repo: mocks as unknown as IVenueReviewRepository, mocks };
}

function makeActivityRepo(): IActivityReviewRepository {
  return {
    list:         vi.fn().mockResolvedValue([]),
    getById:      vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    markPromoted: vi.fn().mockResolvedValue(undefined),
  } as unknown as IActivityReviewRepository;
}

describe('ReviewService.reviewVenue — roles', () => {
  it('viewer NÃO pode aprovar', async () => {
    const { repo } = makeVenueRepo();
    const service = new ReviewService(repo, makeActivityRepo());
    await expect(service.reviewVenue('id', 'approve', makeUser('viewer')))
      .rejects.toThrow(ForbiddenError);
  });

  it('reviewer PODE aprovar', async () => {
    const { repo, mocks } = makeVenueRepo();
    const service = new ReviewService(repo, makeActivityRepo());
    await service.reviewVenue('venue-staging-uuid', 'approve', makeUser('reviewer'));
    expect(mocks.updateStatus).toHaveBeenCalledWith('venue-staging-uuid', expect.objectContaining({ action: 'approve' }));
  });

  it('reviewer NÃO pode promover', async () => {
    const { repo } = makeVenueRepo(makeVenueRow({ proposal_status: 'approved' }));
    const service = new ReviewService(repo, makeActivityRepo());
    await expect(service.reviewVenue('id', 'promote', makeUser('reviewer')))
      .rejects.toThrow(ForbiddenError);
  });

  it('admin PODE promover', async () => {
    const { repo, mocks } = makeVenueRepo(makeVenueRow({ proposal_status: 'approved' }));
    const service = new ReviewService(repo, makeActivityRepo());
    await service.reviewVenue('venue-staging-uuid', 'promote', makeUser('admin'));
    expect(mocks.markPromoted).toHaveBeenCalledWith('venue-staging-uuid', 'user-uuid');
  });
});

describe('ReviewService.reviewVenue — transições', () => {
  it('lança NotFoundError quando venue não existe', async () => {
    const { repo } = makeVenueRepo(null);
    const service = new ReviewService(repo, makeActivityRepo());
    await expect(service.reviewVenue('id', 'approve', makeUser('reviewer')))
      .rejects.toThrow(NotFoundError);
  });

  it('approve chama updateStatus com action=approve', async () => {
    const { repo, mocks } = makeVenueRepo();
    const service = new ReviewService(repo, makeActivityRepo());
    await service.reviewVenue('venue-staging-uuid', 'approve', makeUser('reviewer'));
    expect(mocks.updateStatus).toHaveBeenCalledWith(
      'venue-staging-uuid',
      expect.objectContaining({ action: 'approve', reviewedBy: 'user-uuid' }),
    );
  });

  it('reject chama updateStatus com action=reject', async () => {
    const { repo, mocks } = makeVenueRepo();
    const service = new ReviewService(repo, makeActivityRepo());
    await service.reviewVenue('venue-staging-uuid', 'reject', makeUser('reviewer'));
    expect(mocks.updateStatus).toHaveBeenCalledWith(
      'venue-staging-uuid',
      expect.objectContaining({ action: 'reject' }),
    );
  });

  it('promote chama markPromoted, não updateStatus', async () => {
    const { repo, mocks } = makeVenueRepo(makeVenueRow({ proposal_status: 'approved' }));
    const service = new ReviewService(repo, makeActivityRepo());
    await service.reviewVenue('venue-staging-uuid', 'promote', makeUser('admin'));
    expect(mocks.markPromoted).toHaveBeenCalled();
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });
});

describe('ReviewService.listVenues', () => {
  it('delega ao repositório com o filtro passado', async () => {
    const { repo, mocks } = makeVenueRepo();
    const service = new ReviewService(repo, makeActivityRepo());
    const filter = { status: 'pending_review' as const, product_key: 'vivere-60-mais', limit: 10, offset: 0 };
    await service.listVenues(filter);
    expect(mocks.list).toHaveBeenCalledWith(filter);
  });
});
