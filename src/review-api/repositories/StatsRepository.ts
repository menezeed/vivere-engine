import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlatformStats } from '../types/reviewTypes';

const COST_PER_QUERY_USD  = 0.032;
const MONTHLY_BUDGET_USD  = 10.0;
const ALERT_THRESHOLD_PCT = 80;
const ITEMS_PER_QUERY     = 20;

export class StatsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async getPlatformStats(productKey: string): Promise<PlatformStats> {
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [venuesRes, activitiesRes, activitiesUnresolvedRes, lastRunRes, monthRunsRes, recentRunsRes] =
      await Promise.all([
        // Contagens de venues por status
        this.db.schema('staging').from('venues_staging')
          .select('proposal_status').eq('product_key', productKey),

        // Contagens de activities por status
        this.db.schema('staging').from('activities_staging')
          .select('proposal_status, venue_resolution_status').eq('product_key', productKey),

        // W4 — activities sem venue resolvido
        this.db.schema('staging').from('activities_staging')
          .select('id', { count: 'exact', head: true })
          .eq('product_key', productKey)
          .eq('venue_resolution_status', 'unresolved'),

        // W5 — última run (qualquer source) com status
        this.db.schema('staging').from('ingestion_runs')
          .select('source_key, started_at, finished_at, items_collected, items_errored, status')
          .order('started_at', { ascending: false })
          .limit(1),

        // W8 — budget: runs Google Places no mês
        this.db.schema('staging').from('ingestion_runs')
          .select('items_collected')
          .eq('source_key', 'google_places')
          .eq('status', 'success')
          .gte('started_at', monthStart),

        // W6 — estado por source: última run de cada source
        this.db.schema('staging').from('ingestion_runs')
          .select('source_key, status, started_at, finished_at, items_collected, items_errored')
          .order('started_at', { ascending: false })
          .limit(20),
      ]);

    if (venuesRes.error)    throw new Error(`StatsRepository.venues: ${venuesRes.error.message}`);
    if (activitiesRes.error) throw new Error(`StatsRepository.activities: ${activitiesRes.error.message}`);

    const count = (rows: Array<{ proposal_status: string }>, status: string) =>
      rows.filter(r => r.proposal_status === status).length;

    // Budget
    const monthItems       = (monthRunsRes.data ?? []).reduce((acc, r) => acc + (r.items_collected ?? 0), 0);
    const estimatedQueries = Math.ceil(monthItems / ITEMS_PER_QUERY);
    const estimatedSpent   = Math.round(estimatedQueries * COST_PER_QUERY_USD * 100) / 100;
    const estimatedRemaining = Math.round((MONTHLY_BUDGET_USD - estimatedSpent) * 100) / 100;
    const usagePct           = Math.round((estimatedSpent / MONTHLY_BUDGET_USD) * 1000) / 10;

    // W5 — última run com status
    const lastRun = lastRunRes.data?.[0] ?? null;

    // W6 — última run por source (deduplica pelo source_key mais recente)
    const seenSources = new Set<string>();
    const bySource: PlatformStats['ingestion']['by_source'] = [];
    for (const run of recentRunsRes.data ?? []) {
      if (!seenSources.has(run.source_key)) {
        seenSources.add(run.source_key);
        const durationMs = run.finished_at && run.started_at
          ? new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
          : null;
        bySource.push({
          source_key:      run.source_key,
          last_status:     run.status,
          last_run_at:     run.started_at,
          last_run_items:  run.items_collected ?? 0,
          last_run_errors: run.items_errored ?? 0,
          duration_ms:     durationMs,
        });
      }
    }

    return {
      venues: {
        pending_review: count(venuesRes.data, 'pending_review'),
        approved:       count(venuesRes.data, 'approved'),
        rejected:       count(venuesRes.data, 'rejected'),
        promoted:       count(venuesRes.data, 'promoted'),
        total:          venuesRes.data.length,
      },
      activities: {
        pending_review:   count(activitiesRes.data, 'pending_review'),
        approved:         count(activitiesRes.data, 'approved'),
        rejected:         count(activitiesRes.data, 'rejected'),
        promoted:         count(activitiesRes.data, 'promoted'),
        total:            activitiesRes.data.length,
        unresolved_venue: activitiesUnresolvedRes.count ?? 0,
      },
      ingestion: {
        last_run_at:     lastRun?.started_at ?? null,
        last_run_source: lastRun?.source_key ?? null,
        last_run_items:  lastRun?.items_collected ?? null,
        last_run_status: lastRun?.status ?? null,
        runs_this_month: (monthRunsRes.data ?? []).length,
        by_source:       bySource,
      },
      budget: {
        monthly_limit_usd:       MONTHLY_BUDGET_USD,
        estimated_spent_usd:     estimatedSpent,
        estimated_remaining_usd: estimatedRemaining,
        usage_pct:               usagePct,
        alert:                   usagePct >= ALERT_THRESHOLD_PCT,
      },
    };
  }
}
