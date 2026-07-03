import { Hono } from 'hono';
import type { ReviewService } from '../services/ReviewService';
import { NotFoundError, ForbiddenError } from '../services/ReviewService';
import type { AuthUser, ReviewFilter } from '../types/reviewTypes';

type Env = { Variables: { user: AuthUser } };

export function venueRoutes(reviewService: ReviewService): Hono<Env> {
  const router = new Hono<Env>();

  router.get('/', async (c) => {
    const filter: ReviewFilter = {
      status:      (c.req.query('status') as ReviewFilter['status']) ?? 'pending_review',
      product_key: c.req.query('product_key'),
      limit:       c.req.query('limit')  ? Number(c.req.query('limit'))  : 20,
      offset:      c.req.query('offset') ? Number(c.req.query('offset')) : 0,
    };
    try {
      const venues = await reviewService.listVenues(filter);
      return c.json({ data: venues, count: venues.length, filter });
    } catch (err) { return c.json({ error: String(err) }, 500); }
  });

  router.get('/:id', async (c) => {
    try {
      const venue = await reviewService.getVenue(c.req.param('id'));
      return c.json({ data: venue });
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.patch('/:id/approve', async (c) => {
    const user = c.get('user');
    try {
      await reviewService.reviewVenue(c.req.param('id'), 'approve', user);
      return c.json({ success: true, action: 'approve' });
    } catch (err) {
      if (err instanceof NotFoundError)  return c.json({ error: err.message }, 404);
      if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.patch('/:id/reject', async (c) => {
    const user = c.get('user');
    try {
      await reviewService.reviewVenue(c.req.param('id'), 'reject', user);
      return c.json({ success: true, action: 'reject' });
    } catch (err) {
      if (err instanceof NotFoundError)  return c.json({ error: err.message }, 404);
      if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.patch('/:id/promote', async (c) => {
    const user = c.get('user');
    try {
      await reviewService.reviewVenue(c.req.param('id'), 'promote', user);
      return c.json({ success: true, action: 'promote' });
    } catch (err) {
      if (err instanceof NotFoundError)  return c.json({ error: err.message }, 404);
      if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
