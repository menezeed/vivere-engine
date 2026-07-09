/**
 * src/review-api/routes/entity-resolution.ts
 *
 * Routes de Entity Resolution — exactamente o mesmo padrão das routes existentes.
 * Routes finas: parsing de params → service → resposta/erro.
 */

import { Hono } from 'hono';
import type { EntityResolutionService } from '../services/EntityResolutionService.js';
import { NotFoundError, ForbiddenError } from '../services/ReviewService.js';
import type { AuthUser } from '../types/reviewTypes.js';
import { logger } from '../../lib/logger.js';

type Env = { Variables: { user: AuthUser } };

export function entityResolutionRoutes(erService: EntityResolutionService): Hono<Env> {
  const router = new Hono<Env>();

  // ── GET /api/entity-resolution/health ────────────────────────────────────
  // viewer, reviewer, admin
  router.get('/health', async (c) => {
    try {
      const productKey = c.req.query('product_key');
      if (!productKey) return c.json({ error: 'product_key é obrigatório' }, 400);
      const health = await erService.getHealth(productKey);
      const httpStatus = health.status === 'critical' ? 503 : 200;
      return c.json({ data: health }, httpStatus);
    } catch (err) {
      logger.error({ err }, 'er health error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  // ── GET /api/entity-resolution/queue ──────────────────────────────────────
  // viewer, reviewer, admin
  router.get('/queue', async (c) => {
    try {
      const productKey = c.req.query('product_key');
      if (!productKey) return c.json({ error: 'product_key é obrigatório' }, 400);

      const result = await erService.listQueue(
        productKey,
        c.req.query('status') || undefined,
        c.req.query('page')     ? Number(c.req.query('page'))     : 1,
        c.req.query('pageSize') ? Number(c.req.query('pageSize')) : 20,
      );
      return c.json(result);
    } catch (err) {
      logger.error({ err }, 'er queue error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  // ── GET /api/entity-resolution/stats ──────────────────────────────────────
  // viewer, reviewer, admin
  router.get('/stats', async (c) => {
    try {
      const productKey = c.req.query('product_key');
      if (!productKey) return c.json({ error: 'product_key é obrigatório' }, 400);

      const stats = await erService.getStats(productKey);
      return c.json({ data: stats });
    } catch (err) {
      logger.error({ err }, 'er stats error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  // ── GET /api/entity-resolution/:activityId/candidates ────────────────────
  // viewer, reviewer, admin
  router.get('/:activityId/candidates', async (c) => {
    try {
      const candidates = await erService.listCandidates(c.req.param('activityId'));
      return c.json({ data: candidates });
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
      logger.error({ err, activityId: c.req.param('activityId') }, 'er candidates error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  // ── PATCH /api/entity-resolution/:activityId/accept ──────────────────────
  // reviewer, admin
  router.patch('/:activityId/accept', async (c) => {
    const user = c.get('user');
    try {
      const body = await c.req.json<{ candidateId?: string; notes?: string }>();
      await erService.accept(
        c.req.param('activityId'),
        body.candidateId ?? '',
        user,
        body.notes ?? null,
      );
      return c.json({ success: true, action: 'accept' });
    } catch (err) {
      if (err instanceof NotFoundError)  return c.json({ error: err.message }, 404);
      if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
      if (err instanceof Error && err.message.includes('obrigatório'))
        return c.json({ error: err.message }, 400);
      logger.error({ err, activityId: c.req.param('activityId'), userId: user.id }, 'er accept error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  // ── PATCH /api/entity-resolution/:activityId/override ────────────────────
  // reviewer, admin
  router.patch('/:activityId/override', async (c) => {
    const user = c.get('user');
    try {
      const body = await c.req.json<{ candidateId?: string; notes?: string }>();
      await erService.override(
        c.req.param('activityId'),
        body.candidateId ?? '',
        user,
        body.notes ?? '',
      );
      return c.json({ success: true, action: 'override' });
    } catch (err) {
      if (err instanceof NotFoundError)  return c.json({ error: err.message }, 404);
      if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
      if (err instanceof Error && err.message.includes('obrigatório'))
        return c.json({ error: err.message }, 400);
      logger.error({ err, activityId: c.req.param('activityId'), userId: user.id }, 'er override error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  // ── PATCH /api/entity-resolution/:activityId/propose-new ─────────────────
  // admin only
  router.patch('/:activityId/propose-new', async (c) => {
    const user = c.get('user');
    try {
      const body = await c.req.json<{ notes?: string }>().catch(() => ({ notes: undefined }));
      await erService.proposeNew(
        c.req.param('activityId'),
        user,
        body.notes ?? null,
      );
      return c.json({ success: true, action: 'propose-new' });
    } catch (err) {
      if (err instanceof NotFoundError)  return c.json({ error: err.message }, 404);
      if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
      logger.error({ err, activityId: c.req.param('activityId'), userId: user.id }, 'er propose-new error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  return router;
}
