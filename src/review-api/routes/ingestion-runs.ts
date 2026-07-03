import { Hono } from 'hono';
import type { IIngestionRunReadRepository } from '../../persistence/types/repositoryInterfaces';
import type { SupabaseClient } from '@supabase/supabase-js';

export function ingestionRunRoutes(repo: IIngestionRunReadRepository): Hono {
  const router = new Hono();

  router.get('/', async (c) => {
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 20;
    try {
      const runs = await repo.list(limit);
      return c.json({ data: runs, count: runs.length });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}

export function statsRoutes(db: SupabaseClient): Hono {
  const router = new Hono();

  // GET /stats — contagens por proposal_status
  router.get('/', async (c) => {
    try {
      const [venuesRes, activitiesRes] = await Promise.all([
        db.schema('staging').from('venues_staging').select('proposal_status, product_key'),
        db.schema('staging').from('activities_staging').select('proposal_status, product_key'),
      ]);

      if (venuesRes.error) throw new Error(venuesRes.error.message);
      if (activitiesRes.error) throw new Error(activitiesRes.error.message);

      const count = (rows: Array<{ proposal_status: string }>, status: string) =>
        rows.filter(r => r.proposal_status === status).length;

      return c.json({
        venues: {
          pending_review: count(venuesRes.data, 'pending_review'),
          approved:       count(venuesRes.data, 'approved'),
          rejected:       count(venuesRes.data, 'rejected'),
          promoted:       count(venuesRes.data, 'promoted'),
          total:          venuesRes.data.length,
        },
        activities: {
          pending_review: count(activitiesRes.data, 'pending_review'),
          approved:       count(activitiesRes.data, 'approved'),
          rejected:       count(activitiesRes.data, 'rejected'),
          promoted:       count(activitiesRes.data, 'promoted'),
          total:          activitiesRes.data.length,
        },
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
