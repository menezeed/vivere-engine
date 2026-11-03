/**
 * Montagem da app Hono do Review API, separada de server.ts para que as
 * rotas e a autorização possam ser testadas sem base de dados nem rede.
 * server.ts continua a ser o único ponto de arranque.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import type { IIngestionRunReadRepository } from '../persistence/types/repositoryInterfaces';
import type { StatsRepository } from './repositories/StatsRepository.js';
import type { ReviewService } from './services/ReviewService.js';
import { ER_ACTION_ROLES, type EntityResolutionService } from './services/EntityResolutionService.js';
import { authMiddleware, requireRole, VALID_ROLES } from './middleware/auth.js';
import { ACTION_ROLES, type UserRole } from './types/reviewTypes.js';
import { venueRoutes } from './routes/venues.js';
import { activityRoutes } from './routes/activities.js';
import { ingestionRunRoutes, statsRoutes } from './routes/ingestion-runs.js';
import { entityResolutionRoutes } from './routes/entity-resolution.js';

export interface ReviewApiDeps {
  corsOrigin:    string | string[];
  reviewService: ReviewService;
  erService:     EntityResolutionService;
  runRepo:       IIngestionRunReadRepository;
  statsRepo:     StatsRepository;
  /** Desligar o log de pedidos nos testes. */
  requestLogging?: boolean;
}

/**
 * SEC-A — matriz de permissões das rotas de escrita, derivada das MESMAS
 * tabelas que os serviços usam (ACTION_ROLES, ER_ACTION_ROLES). Os serviços
 * continuam a verificar o papel; isto é uma segunda camada, à entrada.
 */
export const MUTATION_ROLE_MATRIX: ReadonlyArray<{ method: 'PATCH'; path: string; roles: readonly UserRole[] }> = [
  ...(['venues', 'activities'] as const).flatMap((resource) =>
    (['approve', 'reject', 'promote'] as const).map((action) => ({
      method: 'PATCH' as const,
      path:   `/api/${resource}/:id/${action}`,
      roles:  ACTION_ROLES[action],
    })),
  ),
  { method: 'PATCH', path: '/api/entity-resolution/:activityId/accept',      roles: ER_ACTION_ROLES.accept },
  { method: 'PATCH', path: '/api/entity-resolution/:activityId/override',    roles: ER_ACTION_ROLES.override },
  { method: 'PATCH', path: '/api/entity-resolution/:activityId/propose-new', roles: ER_ACTION_ROLES.proposeNew },
];

export function createApp(deps: ReviewApiDeps): Hono {
  const app = new Hono();

  app.use('*', cors({ origin: deps.corsOrigin }));
  if (deps.requestLogging !== false) app.use('*', honoLogger());

  // 1. Autenticação (401) + papel explícito obrigatório (403).
  app.use('/api/*', authMiddleware);
  // 2. Leitura: qualquer papel válido (viewer+), aplicado a toda a /api/*.
  app.use('/api/*', requireRole(...VALID_ROLES));
  // 3. Escrita: papel exigido por rota, antes de chegar ao serviço.
  for (const { path, roles } of MUTATION_ROLE_MATRIX) {
    app.patch(path, requireRole(...roles));
  }

  app.get('/health', (c) => c.json({
    status:  'ok',
    service: 'vivere-review-api',
    version: '0.1.0',
    env:     process.env.NODE_ENV ?? 'development',
  }));

  app.route('/api/venues',            venueRoutes(deps.reviewService));
  app.route('/api/activities',        activityRoutes(deps.reviewService));
  app.route('/api/ingestion-runs',    ingestionRunRoutes(deps.runRepo));
  app.route('/api/stats',             statsRoutes(deps.statsRepo));
  app.route('/api/entity-resolution', entityResolutionRoutes(deps.erService));

  return app;
}
