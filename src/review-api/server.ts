import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { getSupabaseClient } from '../persistence/client/supabase.js';
import { VenueReviewRepository } from './repositories/VenueReviewRepository.js';
import { ActivityReviewRepository } from './repositories/ActivityReviewRepository.js';
import { IngestionRunReadRepository } from './repositories/IngestionRunReadRepository.js';
import { ReviewService } from './services/ReviewService.js';
import { authMiddleware } from './middleware/auth.js';
import { venueRoutes } from './routes/venues.js';
import { activityRoutes } from './routes/activities.js';
import { ingestionRunRoutes, statsRoutes } from './routes/ingestion-runs.js';

const PORT = Number(process.env.REVIEW_API_PORT ?? 3001);

async function buildApp(): Promise<Hono> {
  const db = getSupabaseClient();

  // Repositórios
  const venueRepo    = new VenueReviewRepository(db);
  const activityRepo = new ActivityReviewRepository(db);
  const runRepo      = new IngestionRunReadRepository(db);

  // Serviços
  const reviewService = new ReviewService(venueRepo, activityRepo);

  // App Hono
  const app = new Hono();

  // Middlewares globais
  app.use('*', cors({ origin: process.env.CORS_ORIGIN ?? '*' }));
  app.use('*', honoLogger());
  app.use('/api/*', authMiddleware);

  // Health check — sem auth
  app.get('/health', (c) => c.json({ status: 'ok', service: 'vivere-review-api', version: '0.1.0' }));

  // Rotas protegidas
  app.route('/api/venues',         venueRoutes(reviewService));
  app.route('/api/activities',     activityRoutes(reviewService));
  app.route('/api/ingestion-runs', ingestionRunRoutes(runRepo));
  app.route('/api/stats',          statsRoutes(db));

  return app;
}

// Inicialização
const app = await buildApp();

const { serve } = await import('@hono/node-server');
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Vivere Review API rodando em http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
