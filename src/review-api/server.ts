import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { getSupabaseClient } from '../persistence/client/supabase.js';
import { VenueReviewRepository } from './repositories/VenueReviewRepository.js';
import { ActivityReviewRepository } from './repositories/ActivityReviewRepository.js';
import { IngestionRunReadRepository } from './repositories/IngestionRunReadRepository.js';
import { StatsRepository } from './repositories/StatsRepository.js';
import { ReviewService } from './services/ReviewService.js';
import { authMiddleware } from './middleware/auth.js';
import { venueRoutes } from './routes/venues.js';
import { activityRoutes } from './routes/activities.js';
import { ingestionRunRoutes, statsRoutes } from './routes/ingestion-runs.js';
import { logger } from '../lib/logger.js';

const PORT     = Number(process.env.REVIEW_API_PORT ?? 3001);
const NODE_ENV = process.env.NODE_ENV ?? 'development';

// C5 — CORS seguro: wildcard apenas em desenvolvimento
function resolveCorsOrigin(): string | string[] {
  const envOrigin = process.env.CORS_ORIGIN;

  if (envOrigin) return envOrigin;

  if (NODE_ENV === 'production') {
    // Em produção sem CORS_ORIGIN definido: erro crítico no startup
    logger.error(
      'CORS_ORIGIN não está definido em NODE_ENV=production. ' +
      'A API não deve aceitar requests de origens arbitrárias em produção. ' +
      'Defina CORS_ORIGIN=https://admin.vivere.com.br no ambiente.',
    );
    process.exit(1);
  }

  // Desenvolvimento: aceita localhost nas portas padrão do Vite e outros
  logger.warn('CORS_ORIGIN não definido — a aceitar localhost em modo desenvolvimento');
  return ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173'];
}

async function buildApp(): Promise<Hono> {
  const corsOrigin = resolveCorsOrigin();
  const db         = getSupabaseClient();

  const venueRepo    = new VenueReviewRepository(db);
  const activityRepo = new ActivityReviewRepository(db);
  const runRepo      = new IngestionRunReadRepository(db);
  const statsRepo    = new StatsRepository(db);
  const reviewService = new ReviewService(venueRepo, activityRepo);

  const app = new Hono();

  app.use('*', cors({ origin: corsOrigin }));
  app.use('*', honoLogger());
  app.use('/api/*', authMiddleware);

  app.get('/health', (c) => c.json({
    status:  'ok',
    service: 'vivere-review-api',
    version: '0.1.0',
    env:     NODE_ENV,
  }));

  app.route('/api/venues',         venueRoutes(reviewService));
  app.route('/api/activities',     activityRoutes(reviewService));
  app.route('/api/ingestion-runs', ingestionRunRoutes(runRepo));
  app.route('/api/stats',          statsRoutes(statsRepo));

  return app;
}

const app = await buildApp();
const { serve } = await import('@hono/node-server');
serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info({ port: PORT, env: NODE_ENV }, 'Vivere Review API iniciada');
  console.log(`Vivere Review API rodando em http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
