import { useQuery } from '@tanstack/react-query';
import { useOutletContext, Link } from 'react-router-dom';
import { MapPin, Calendar, Clock, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';
import { StatsService } from '@/services/StatsService';
import { StatCard, SectionCard } from '@/components/ui/Cards';
import { Skeleton } from '@/components/ui/index';
import type { AppOutletContext } from '@/types/shell';
import { timeAgo } from '@/lib/formatters';


export function DashboardPage() {
  const { productKey } = useOutletContext<AppOutletContext>();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats', productKey],
    queryFn: () => StatsService.getStats(productKey),
    refetchInterval: 30_000,
  });

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['ingestion-runs'],
    queryFn: () => StatsService.getIngestionRuns(5),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  const budget = stats?.budget;
  const budgetColor = budget?.alert ? 'bg-red-500'
    : (budget?.usage_pct ?? 0) > 60 ? 'bg-yellow-500'
    : 'bg-vivere-teal';

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-xl font-bold text-vivere-dark">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-0.5">{productKey}</p>
      </div>

      {/* Venues KPIs */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <MapPin size={12} /> Venues
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Link to="/venues?status=pending_review">
            <StatCard label="Pendentes" value={stats?.venues.pending_review ?? 0}
              icon={MapPin} iconColor="text-amber-600" iconBg="bg-amber-50" accent />
          </Link>
          <StatCard label="Aprovados"  value={stats?.venues.approved ?? 0}
            icon={MapPin} iconColor="text-green-600" iconBg="bg-green-50" />
          <StatCard label="Rejeitados" value={stats?.venues.rejected ?? 0}
            icon={MapPin} iconColor="text-red-500" iconBg="bg-red-50" />
          <StatCard label="Promovidos" value={stats?.venues.promoted ?? 0}
            icon={MapPin} iconColor="text-blue-600" iconBg="bg-blue-50" />
        </div>
      </section>

      {/* Activities KPIs */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Calendar size={12} /> Actividades
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Link to="/activities?status=pending_review">
            <StatCard label="Pendentes" value={stats?.activities.pending_review ?? 0}
              icon={Calendar} iconColor="text-amber-600" iconBg="bg-amber-50" accent />
          </Link>
          <StatCard label="Aprovadas"  value={stats?.activities.approved ?? 0}
            icon={Calendar} iconColor="text-green-600" iconBg="bg-green-50" />
          <StatCard label="Rejeitadas" value={stats?.activities.rejected ?? 0}
            icon={Calendar} iconColor="text-red-500" iconBg="bg-red-50" />
          <StatCard label="Promovidas" value={stats?.activities.promoted ?? 0}
            icon={Calendar} iconColor="text-blue-600" iconBg="bg-blue-50" />
        </div>
      </section>

      {/* Budget + Ingestão */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Budget */}
        <SectionCard title="Budget Google Places">
          {budget ? (
            <>
              <p className="text-2xl font-bold text-vivere-dark">
                ${budget.estimated_spent_usd.toFixed(2)}
                <span className="text-sm font-normal text-gray-400"> / ${budget.monthly_limit_usd.toFixed(2)}</span>
              </p>
              <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${budgetColor}`}
                  style={{ width: `${Math.min(budget.usage_pct, 100)}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                {budget.usage_pct}% utilizado · ${budget.estimated_remaining_usd.toFixed(2)} restante
              </p>
              {budget.alert && (
                <p className="flex items-center gap-1 text-xs text-red-500 mt-2">
                  <AlertTriangle size={11} /> Alerta de orçamento
                </p>
              )}
            </>
          ) : <Skeleton className="h-16" />}
        </SectionCard>

        {/* Última ingestão */}
        <SectionCard title="Última Ingestão">
          {stats?.ingestion.last_run_at ? (
            <>
              <p className="text-lg font-semibold text-vivere-dark">
                {timeAgo(stats.ingestion.last_run_at)}
              </p>
              <p className="text-xs text-gray-400 mt-1">{stats.ingestion.last_run_source}</p>
              <p className="text-xs text-gray-400">{stats.ingestion.last_run_items} itens</p>
            </>
          ) : <p className="text-sm text-gray-400">Nenhuma ingestão registada</p>}
        </SectionCard>

        {/* Runs este mês */}
        <StatCard label="Runs este mês" value={stats?.ingestion.runs_this_month ?? 0}
          icon={TrendingUp} iconColor="text-vivere-teal" iconBg="bg-teal-50"
          trendLabel="Google Places" trend="neutral" />
      </div>

      {/* Últimas ingestões */}
      <SectionCard title="Últimas Ingestões" padding={false}>
        {runsLoading ? (
          <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                {['Source', 'Status', 'Itens', 'Início'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs?.map(run => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{run.source_key}</td>
                  <td className="px-4 py-3">
                    {run.status === 'success'
                      ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={12} /> success</span>
                      : <span className="flex items-center gap-1 text-red-600 text-xs"><AlertTriangle size={12} /> {run.status}</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-gray-600">{run.items_collected}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{timeAgo(run.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}
