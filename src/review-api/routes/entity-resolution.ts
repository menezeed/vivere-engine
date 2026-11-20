/**
 * src/review-api/routes/entity-resolution.ts
 *
 * Routes de Entity Resolution — exactamente o mesmo padrão das routes existentes.
 * Routes finas: parsing de params → service → resposta/erro.
 */

import { Hono, type Context } from 'hono';
import type { EntityResolutionService } from '../services/EntityResolutionService.js';
import { NotFoundError, ForbiddenError } from '../services/ReviewService.js';
import type { AuthUser } from '../types/reviewTypes.js';
import { logger } from '../../lib/logger.js';
import { bodyLimit } from 'hono/body-limit';
import { requireUuidParam } from '../middleware/uuidParam.js';
import { rejectInvalidIntQuery } from '../middleware/paginationQuery.js';

type Env = { Variables: { user: AuthUser } };

/** Tecto do corpo das decisões de ER (bytes) e de notes (caracteres). */
export const ER_BODY_MAX_BYTES = 16 * 1024;
export const ER_NOTES_MAX_LENGTH = 2000;

export function entityResolutionRoutes(erService: EntityResolutionService): Hono<Env> {
  const router = new Hono<Env>();
  // :activityId tem de ser UUID → 400. Lista EXPLÍCITA: '/:activityId/*'
  // também casaria /health, /queue e /stats (o '*' aceita sufixo vazio).
  for (const suffix of ['candidates', 'accept', 'override', 'propose-new']) {
    router.use(`/:activityId/${suffix}`, requireUuidParam('activityId'));
  }
  // Corpo das decisões limitado (revisão r0 do #38): sem isto um corpo enorme
  // era lido por inteiro e notes persistido sem tecto (coluna TEXT).
  for (const suffix of ['accept', 'override', 'propose-new']) {
    router.use(`/:activityId/${suffix}`, bodyLimit({
      maxSize: ER_BODY_MAX_BYTES,
      onError: (c) => c.json({ error: 'Corpo do pedido demasiado grande' }, 413),
    }));
  }

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
    const invalid = rejectInvalidIntQuery(c, ['page', 'pageSize']);
    if (invalid) return invalid;
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
      // Corpo que não é um objecto JSON → 400, sem chegar ao serviço (antes:
      // SyntaxError caía no ramo genérico → 500 "Erro interno" + log de erro).
      const body = await readJsonObject<{ candidateId?: string; notes?: string }>(c);
      if (body === null) return c.json({ error: 'Corpo do pedido inválido: é esperado um objecto JSON' }, 400);
      const badField = nonStringField(body, ['candidateId', 'notes']);
      if (badField) return c.json({ error: `Corpo do pedido inválido: ${badField} tem de ser texto` }, 400);
      const tooLong = notesTooLong(c, body);
      if (tooLong) return tooLong;
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
      // Corpo que não é um objecto JSON → 400, sem chegar ao serviço (antes:
      // SyntaxError caía no ramo genérico → 500 "Erro interno" + log de erro).
      const body = await readJsonObject<{ candidateId?: string; notes?: string }>(c);
      if (body === null) return c.json({ error: 'Corpo do pedido inválido: é esperado um objecto JSON' }, 400);
      const badField = nonStringField(body, ['candidateId', 'notes']);
      if (badField) return c.json({ error: `Corpo do pedido inválido: ${badField} tem de ser texto` }, 400);
      const tooLong = notesTooLong(c, body);
      if (tooLong) return tooLong;
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
      // Corpo OPCIONAL (contrato existente): vazio → sem notas. Mas um corpo
      // presente que não seja objecto JSON → 400 (revisão r0 do #34: antes o
      // JSON mal formado era engolido e a decisão executada; 'null' dava 500).
      const body = await readOptionalJsonObject<{ notes?: string }>(c);
      if (body === null) return c.json({ error: 'Corpo do pedido inválido: é esperado um objecto JSON' }, 400);
      const badField = nonStringField(body, ['notes']);
      if (badField) return c.json({ error: `Corpo do pedido inválido: ${badField} tem de ser texto` }, 400);
      const tooLong = notesTooLong(c, body);
      if (tooLong) return tooLong;
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

/**
 * Primeiro campo presente que não é texto nem null (null/ausente são aceites:
 * o serviço trata a obrigatoriedade). Antes, notes: 5 ou {} no override dava
 * TypeError em notes.trim() → 500, e no accept chegava à base como não-texto.
 */
function nonStringField(body: object, names: readonly string[]): string | null {
  const rec = body as Record<string, unknown>;
  for (const name of names) {
    const v = rec[name];
    if (v !== undefined && v !== null && typeof v !== 'string') return name;
  }
  return null;
}

/** 400 se notes exceder ER_NOTES_MAX_LENGTH (revisão r0 do #38); senão null. */
function notesTooLong(c: Context, body: object): Response | null {
  const notes = (body as Record<string, unknown>)['notes'];
  if (typeof notes === 'string' && notes.length > ER_NOTES_MAX_LENGTH) {
    return c.json({ error: `Corpo do pedido inválido: notes excede ${ER_NOTES_MAX_LENGTH} caracteres` }, 400);
  }
  return null;
}

/** Corpo opcional: vazio → {}; senão tem de ser objecto JSON (null se não for). */
async function readOptionalJsonObject<T extends object>(c: { req: { text: () => Promise<string> } }): Promise<T | null> {
  const text = await c.req.text();
  if (text.trim() === '') return {} as T;
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

/** Lê o corpo como objecto JSON; null se não for JSON válido ou não for um objecto. */
async function readJsonObject<T extends object>(c: { req: { json: () => Promise<unknown> } }): Promise<T | null> {
  try {
    const v = await c.req.json();
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
}
