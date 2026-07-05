import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlatformStats } from '../types/reviewTypes';

// Constantes de negócio — devem vir de configuração em fases futuras
const COST_PER_QUERY_USD  = 0.032;
const MONTHLY_BUDGET_USD  = 10.0;
const ALERT_THRESHOLD_PCT = 80;
const ITEMS_PER_QUERY     = 20; // estimativa: cada query Places retorna ~20 itens

export class StatsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async getPlatformStats(productKey: string): Promise<PlatformStats> {
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [venuesRes, activitiesRes, lastRunRes, monthRunsRes] = await Promise.all([
      // Contagens de venues por status — SELECT mínimo, sem JOIN
      this.db
        .schema('staging')
        .from('venues_staging')
        .select('proposal_status')
        .eq('product_key', productKey),

      // Contagens de activities por status
      this.db
        .schema('staging')
        .from('activities_staging')
        .select('proposal_status')
        .eq('product_key', productKey),

      // Última run de qualquer source
      this.db
        .schema('staging')
        .from('ingestion_runs')
        .select('source_key, started_at, items_collected, status')
        .order('started_at', { ascending: false })
        .limit(1),

      // Runs do Google Places no mês corrente para estimar budget
      this.db
        .schema('staging')
        .from('ingestion_runs')
        .select('items_collected')
        .eq('source_key', 'google_places')
        .eq('status', 'success')
        .gte('started_at', monthStart),
    ]);

    if (venuesRes.error)    throw new Error(`StatsRepository.venues: ${venuesRes.error.message}`);
    if (activitiesRes.error) throw new Error(`StatsRepository.activities: ${activitiesRes.error.message}`);

    const count = (rows: Array<{ proposal_status: string }>, status: string) =>
      rows.filter(r => r.proposal_status === status).length;

    // Estimativa de custo: cada ITEMS_PER_QUERY itens colectados ≈ 1 query × COST_PER_QUERY_USD
    const monthItems     = (monthRunsRes.data ?? []).reduce((acc, r) => acc + (r.items_collected ?? 0), 0);
    const estimatedQueries = Math.ceil(monthItems / ITEMS_PER_QUERY);
    const estimatedSpent   = Math.round(estimatedQueries * COST_PER_QUERY_USD * 100) / 100;
    const estimatedRemaining = Math.round((MONTHLY_BUDGET_USD - estimatedSpent) * 100) / 100;
    const usagePct           = Math.round((estimatedSpent / MONTHLY_BUDGET_USD) * 1000) / 10;

    const lastRun = lastRunRes.data?.[0] ?? null;

    return {
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
      ingestion: {
        last_run_at:     lastRun?.started_at ?? null,
        last_run_source: lastRun?.source_key ?? null,
        last_run_items:  lastRun?.items_collected ?? null,
        runs_this_month: (monthRunsRes.data ?? []).length,
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
