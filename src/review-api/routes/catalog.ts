/**
 * /api/catalog/* (Issue #52, Fase 1): catálogo de produção SÓ DE LEITURA.
 *
 * Separado da fila de propostas (/api/venues, /api/activities, staging.*):
 * outro namespace, outra fonte de dados, sem partilha de cliente.
 * Qualquer método que não seja GET responde 405 sem tocar na fonte.
 * Autenticação e papel (viewer+) vêm da cadeia global de /api/* em app.ts.
 */
import { Hono } from 'hono';
import { logger } from '../../lib/logger';
import { requireUuidParam } from '../middleware/uuidParam';
import { activityCompleteness, venueCompleteness } from '../catalog/completeness';
import {
  CATALOG_ACCESS_LABEL, CatalogUpstreamError, ENGINE_STATUSES,
  type ActivitySort, type CatalogSource, type EngineStatus, type VenueSort,
} from '../catalog/catalogTypes';

const INT = /^[0-9]{1,6}$/;
const ACTIVITY_SORTS: readonly ActivitySort[] = ['created_at', 'title', 'start_date'];
const VENUE_SORTS: readonly VenueSort[] = ['name', 'created_at'];
const CATEGORY_KEY = /^[a-z0-9_-]{1,40}$/;

type Q = (name: string) => string | undefined;
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseCommon<S extends string>(q: Q, sorts: readonly S[], defSort: S, defOrder: 'asc' | 'desc'): Parsed<{
  page: number; pageSize: number; search?: string; category?: string; engineStatus?: EngineStatus; sort: S; order: 'asc' | 'desc';
}> {
  const page = q('page'); const size = q('pageSize');
  if (page !== undefined && !INT.test(page)) return { ok: false, error: 'Parâmetro de paginação inválido: page' };
  if (size !== undefined && !INT.test(size)) return { ok: false, error: 'Parâmetro de paginação inválido: pageSize' };
  const pageN = Math.max(1, Number(page ?? 1));
  const sizeN = Number(size ?? 25);
  if (sizeN < 1 || sizeN > 100) return { ok: false, error: 'pageSize tem de estar entre 1 e 100' };
  const category = q('category');
  if (category !== undefined && category !== '' && !CATEGORY_KEY.test(category)) return { ok: false, error: 'category inválida' };
  const status = q('engine_status');
  if (status !== undefined && status !== '' && !ENGINE_STATUSES.includes(status as EngineStatus)) return { ok: false, error: 'engine_status inválido' };
  const sort = (q('sort') ?? defSort) as S;
  if (!sorts.includes(sort)) return { ok: false, error: `sort inválido; aceites: ${sorts.join(', ')}` };
  const order = q('order') ?? defOrder;
  if (order !== 'asc' && order !== 'desc') return { ok: false, error: 'order inválido' };
  return { ok: true, value: {
    page: pageN, pageSize: sizeN, search: q('search') || undefined, category: category || undefined,
    engineStatus: (status || undefined) as EngineStatus | undefined, sort, order,
  } };
}

export function catalogRoutes(source: CatalogSource): Hono {
  const router = new Hono();
  const environment = {
    target: source.target,
    access: 'read-only' as const,
    label: source.target === 'production' ? CATALOG_ACCESS_LABEL : 'DADOS SINTÉTICOS — SOMENTE LEITURA',
  };

  router.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const expected = c.req.query('expected_target');
    if (expected !== undefined && expected !== source.target) {
      return c.json({ error: 'Fonte do catálogo indisponível para esta sessão.', code: 'CATALOG_TARGET_MISMATCH' }, 503);
    }
    await next();
  });

  const fail = (c: import('hono').Context, err: unknown, what: string) => {
    if (err instanceof CatalogUpstreamError && err.status === 400) return c.json({ error: err.message, environment }, 400);
    logger.error({ err: err instanceof Error ? err.message : 'erro', what }, 'catálogo: falha na leitura');
    return c.json({ error: 'Catálogo indisponível', environment }, 502);
  };

  router.get('/status', (c) => c.json({ enabled: true, environment }));

  router.get('/categories', async (c) => {
    try { return c.json({ items: await source.listCategories(), environment }); } catch (e) { return fail(c, e, 'categories'); }
  });

  router.get('/activities', async (c) => {
    const p = parseCommon(c.req.query.bind(c.req) as Q, ACTIVITY_SORTS, 'created_at', 'desc');
    if (!p.ok) return c.json({ error: p.error, environment }, 400);
    const venueId = c.req.query('venue_id') || undefined;
    try {
      const [list, cats] = await Promise.all([source.listActivities({ ...p.value, venueId }), source.listCategories()]);
      const keys = new Set(cats.map((x) => x.key));
      return c.json({ ...list, items: list.items.map((a) => ({ ...a, completeness: activityCompleteness(a, keys) })), environment });
    } catch (e) { return fail(c, e, 'activities'); }
  });

  router.get('/activities/:id', requireUuidParam('id'), async (c) => {
    try {
      const [a, cats] = await Promise.all([source.getActivity(c.req.param('id')), source.listCategories()]);
      if (!a) return c.json({ error: 'Atividade não encontrada', environment }, 404);
      return c.json({ data: { ...a, completeness: activityCompleteness(a, new Set(cats.map((x) => x.key))) }, environment });
    } catch (e) { return fail(c, e, 'activity'); }
  });

  router.get('/venues', async (c) => {
    const p = parseCommon(c.req.query.bind(c.req) as Q, VENUE_SORTS, 'name', 'asc');
    if (!p.ok) return c.json({ error: p.error, environment }, 400);
    try {
      const list = await source.listVenues(p.value);
      return c.json({ ...list, items: list.items.map((v) => ({ ...v, completeness: venueCompleteness(v) })), environment });
    } catch (e) { return fail(c, e, 'venues'); }
  });

  router.get('/venues/:id', requireUuidParam('id'), async (c) => {
    try {
      const v = await source.getVenue(c.req.param('id'));
      if (!v) return c.json({ error: 'Local não encontrado', environment }, 404);
      return c.json({ data: { ...v, completeness: venueCompleteness(v) }, environment });
    } catch (e) { return fail(c, e, 'venue'); }
  });

  return router;
}
