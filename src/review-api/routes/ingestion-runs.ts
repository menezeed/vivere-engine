import { Hono } from 'hono';
import type { IIngestionRunReadRepository } from '../../persistence/types/repositoryInterfaces';
import type { StatsRepository } from '../repositories/StatsRepository';
import { logger } from '../../lib/logger';

export function ingestionRunRoutes(repo: IIngestionRunReadRepository): Hono {
  const router = new Hono();

  router.get('/', async (c) => {
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 20;
    try {
      const runs = await repo.list(limit);
      return c.json({ data: runs, count: runs.length });
    } catch (err) {
      logger.error({ err }, 'ingestion-runs list error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  return router;
}

export function statsRoutes(statsRepo: StatsRepository): Hono {
  const router = new Hono();

  /**
   * GET /api/stats?product_key=vivere-60-mais
   *
   * product_key é OBRIGATÓRIO. Retorna 400 se ausente.
   * Nunca assume um produto por defeito — viola ADR-0004.
   */
  router.get('/', async (c) => {
    const productKey = c.req.query('product_key');

    // C2 — product_key obrigatório, sem fallback silencioso
    if (!productKey) {
      return c.json({
        error: 'product_key é obrigatório',
        hint: 'Exemplo: /api/stats?product_key=vivere-60-mais',
      }, 400);
    }

    try {
      const stats = await statsRepo.getPlatformStats(productKey);
      return c.json(stats);
    } catch (err) {
      // I2 — erro real para o logger, mensagem genérica para o cliente
      logger.error({ err, productKey }, 'stats route error');
      return c.json({ error: 'Erro interno do servidor' }, 500);
    }
  });

  return router;
}
