import { Hono } from 'hono';
import type { ReviewService } from '../services/ReviewService';
import { NotFoundError, ForbiddenError, InvalidQueryError } from '../services/ReviewService';
import { parseEligibilityFilter } from '../eligibility/eligibilityAudit';
import type { AuthUser } from '../types/reviewTypes';
import { logger } from '../../lib/logger';
import { requireUuidParam } from '../middleware/uuidParam';
import { rejectInvalidIntQuery } from '../middleware/paginationQuery';

type Env = { Variables: { user: AuthUser } };

export function activityRoutes(reviewService: ReviewService): Hono<Env> {
  const router = new Hono<Env>();
  // :id tem de ser UUID → 400 (sem consultar a base). Depois de auth/papéis.
  router.use('/:id', requireUuidParam('id'));
  router.use('/:id/*', requireUuidParam('id'));

  router.get('/', async (c) => {
    const invalid = rejectInvalidIntQuery(c, ['page', 'pageSize']);
    if (invalid) return invalid;
    // Issue #62: ?eligibility=confirmed_60plus,likely_suitable,unclear,unsuitable,not_audited
    const eligibility = parseEligibilityFilter(c.req.query('eligibility'));
    if (eligibility === 'invalid') return c.json({ error: 'Parâmetro eligibility inválido' }, 400);
    try {
      const result = await reviewService.listActivities({
        page:             c.req.query('page')             ? Number(c.req.query('page'))             : undefined,
        pageSize:         c.req.query('pageSize')         ? Number(c.req.query('pageSize'))         : undefined,
        search:           c.req.query('search')           || undefined,
        status:           c.req.query('status')           || undefined,
        product_key:      c.req.query('product_key')      || undefined,
        venue_resolution: c.req.query('venue_resolution') || undefined,
        source:           c.req.query('source')           || undefined,
        sort:             c.req.query('sort')             || undefined,
        order:            (c.req.query('order') as 'asc' | 'desc') || undefined,
        ...(eligibility ? { eligibility } : {}),
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof InvalidQueryError) return c.json({ error: err.message }, 400);
      logger.error({ err }, 'activities list error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  router.get('/:id', async (c) => {
    try {
      const activity = await reviewService.getActivity(c.req.param('id'));
      return c.json({ data: activity });
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
      logger.error({ err, id: c.req.param('id') }, 'activity getById error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  for (const action of ['approve', 'reject', 'promote'] as const) {
    router.patch(`/:id/${action}`, async (c) => {
      const user = c.get('user');
      try {
        await reviewService.reviewActivity(c.req.param('id'), action, user);
        return c.json({ success: true, action });
      } catch (err) {
        if (err instanceof NotFoundError)  return c.json({ error: err.message }, 404);
        if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
        logger.error({ err, id: c.req.param('id'), action, userId: user.id }, 'activity review error');
        return c.json({ error: 'Erro interno do servidor' }, 500);
      }
    });
  }

  return router;
}
