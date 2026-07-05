import { useQuery } from '@tanstack/react-query';
import { useOutletContext, Link, useNavigate } from 'react-router-dom';
import {
  MapPin, Calendar, Clock, AlertTriangle, CheckCircle,
  XCircle, ArrowRight, Zap, Activity, TrendingUp,
} from 'lucide-react';
import { StatsService } from '@/services/StatsService';
import { StatCard, SectionCard } from '@/components/ui/Cards';
import { Skeleton } from '@/components/ui/index';
import { timeAgo, formatDateTime, formatUSD } from '@/lib/formatters';
import type { AppOutletContext } from '@/types/shell';
import type { SourceStatus } from '@/types/stats';

// ── Helpers ────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  google_places:        'Google Places',
  prefeitura_cabo_frio: 'Prefeitura Cabo Frio',
};

function sourceLabel(key: string): string {
  return SOURCE_LABELS[key] ?? key;
}

function StatusDot({ status }: { status: string }) {
  const ok = status === 'success';
  const running = status === 'running';
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${
      ok ? 'bg-green-500' : running ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'
    }`} />
  );
}

function durationLabel(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Secção: Review Queue ────────────────────────────────────────

function ReviewQueue({ stats, loading }: {
  stats: ReturnType<typeof useQuery>['data'] extends infer T ? T : never;
  loading: boolean;
}) {
  const navigate = useNavigate();

  const cards = [
    {
      label: 'Venues pendentes',
      value: (stats as any)?.venues.pending_review ?? 0,
      question: 'Quantos venues aguardam revisão?',
      icon: MapPin,
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-50',
      accent: true,
      href: '/venues?status=pending_review',
      alert: ((stats as any)?.venues.pending_review ?? 0) > 50,
    },
    {
      label: 'Actividades pendentes',
      value: (stats as any)?.activities.pending_review ?? 0,
      question: 'Quantas actividades aguardam revisão?',
      icon: Calendar,
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-50',
      accent: true,
      href: '/activities?status=pending_review',
      alert: false,
    },
    {
      label: 'Aprovados → Promover',
      value: (stats as any)?.venues.approved ?? 0,
      question: 'Venues aprovados aguardando promoção?',
      icon: TrendingUp,
      iconColor: ((stats as any)?.venues.approved ?? 0) > 0 ? 'text-blue-600' : 'text-gray-400',
      iconBg:    ((stats as any)?.venues.approved ?? 0) > 0 ? 'bg-blue-50'   : 'bg-gray-50',
      accent: false,
      href: '/venues?status=approved',
      alert: ((stats as any)?.venues.approved ?? 0) > 0,
    },
    {
      label: 'Sem Venue resolvido',
      value: (stats as any)?.activities.unresolved_venue ?? 0,
      question: 'Actividades com venue ainda não identificado?',
      icon: Activity,
      iconColor: ((stats as any)?.activities.unresolved_venue ?? 0) > 0 ? 'text-orange-500' : 'text-gray-400',
      iconBg:    ((stats as any)?.activities.unresolved_venue ?? 0) > 0 ? 'bg-orange-50'   : 'bg-gray-50',
      accent: false,
      href: '/activities?venue_resolution=unresolved',
      alert: ((stats as any)?.activities.unresolved_venue ?? 0) > 0,
    },
  ];

  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Review Queue
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => (
          <Link key={card.label} to={card.href}>
            <StatCard
              label={card.label}
              value={loading ? '—' : card.value}
              icon={card.icon}
              iconColor={card.iconColor}
              iconBg={card.iconBg}
              accent={card.accent}
              loading={loading}
              trendLabel={card.alert && !loading ? '⚠ Requer atenção' : undefined}
              trend={card.alert && !loading ? 'up' : undefined}
              onClick={() => navigate(card.href)}
            />
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Secção: Quick Actions ────────────────────────────────────────

function QuickActions({ stats }: { stats: any }) {
  const actions = [
    {
      label: 'Rever Venues',
      desc: `${stats?.venues.pending_review ?? '—'} pendentes`,
      href: '/venues?status=pending_review',
      color: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
    },
    {
      label: 'Rever Actividades',
      desc: `${stats?.activities.pending_review ?? '—'} pendentes`,
      href: '/activities?status=pending_review',
      color: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
    },
    {
      label: 'Promover Aprovados',
      desc: `${stats?.venues.approved ?? '—'} venues prontos`,
      href: '/venues?status=approved',
      color: stats?.venues.approved > 0
        ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
        : 'bg-gray-50 text-gray-400 cursor-default',
    },
    {
      label: 'Ver Ingestões',
      desc: `${stats?.ingestion.runs_this_month ?? '—'} este mês`,
      href: '/ingestion-runs',
      color: 'bg-teal-50 text-vivere-teal hover:bg-teal-100',
    },
  ];

  return (
    <SectionCard title="Quick Actions" subtitle="Ações operacionais frequentes">
      <div className="grid grid-cols-2 gap-2">
        {actions.map(action => (
          <Link
            key={action.label}
            to={action.href}
            className={`flex items-center justify-between p-3 rounded-lg transition-colors ${action.color}`}
          >
            <div>
              <p className="text-sm font-medium">{action.label}</p>
              <p className="text-xs opacity-70 mt-0.5">{action.desc}</p>
            </div>
            <ArrowRight size={14} className="shrink-0" />
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}

// ── Secção: Budget ────────────────────────────────────────────

function BudgetCard({ budget, loading }: { budget: any; loading: boolean }) {
  if (loading) return <SectionCard title="Budget Google Places"><Skeleton className="h-20" /></SectionCard>;
  if (!budget) return null;

  const pct = budget.usage_pct;
  const barColor = budget.alert ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-vivere-teal';

  return (
    <SectionCard title="Budget Google Places" subtitle="Estimativa mensal">
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <p className="text-3xl font-bold text-vivere-dark">
            {formatUSD(budget.estimated_spent_usd)}
          </p>
          <p className="text-sm text-gray-400 mb-1">
            de {formatUSD(budget.monthly_limit_usd)}
          </p>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{pct}% utilizado</span>
          <span>{formatUSD(budget.estimated_remaining_usd)} restante</span>
        </div>
        {budget.alert && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            <AlertTriangle size={12} />
            Alerta: orçamento acima de 80%
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ── Secção: Sources ────────────────────────────────────────────

function SourcesCard({ sources, loading }: { sources: SourceStatus[]; loading: boolean }) {
  if (loading) return <SectionCard title="Estado das Fontes"><Skeleton className="h-24" /></SectionCard>;

  return (
    <SectionCard title="Estado das Fontes" subtitle="Última execução por source">
      {sources.length === 0 ? (
        <p className="text-sm text-gray-400 italic">Nenhuma ingestão registada</p>
      ) : (
        <div className="space-y-3">
          {sources.map(source => (
            <div key={source.source_key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={source.last_status} />
                <div>
                  <p className="text-sm font-medium text-vivere-dark">
                    {sourceLabel(source.source_key)}
                  </p>
                  <p className="text-xs text-gray-400">
                    {timeAgo(source.last_run_at)} · {source.last_run_items} itens
                    {source.duration_ms !== null && ` · ${durationLabel(source.duration_ms)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {source.last_status === 'success' ? (
                  <CheckCircle size={14} className="text-green-500" />
                ) : source.last_status === 'failed' ? (
                  <XCircle size={14} className="text-red-500" />
                ) : (
                  <Zap size={14} className="text-yellow-500" />
                )}
                {source.last_run_errors > 0 && (
                  <span className="text-xs text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                    {source.last_run_errors} erros
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── Secção: Última Ingestão ────────────────────────────────────

function LastRunCard({ ingestion, loading }: { ingestion: any; loading: boolean }) {
  if (loading) return <SectionCard title="Última Ingestão"><Skeleton className="h-20" /></SectionCard>;

  const ok = ingestion?.last_run_status === 'success';
  const hasData = !!ingestion?.last_run_at;

  return (
    <SectionCard title="Última Ingestão">
      {!hasData ? (
        <p className="text-sm text-gray-400 italic">Nenhuma ingestão registada</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {ok
              ? <CheckCircle size={16} className="text-green-500" />
              : <XCircle size={16} className="text-red-500" />
            }
            <p className="text-lg font-semibold text-vivere-dark">
              {timeAgo(ingestion.last_run_at)}
            </p>
          </div>
          <p className="text-xs text-gray-400">
            {sourceLabel(ingestion.last_run_source ?? '')}
          </p>
          <p className="text-xs text-gray-400">
            {ingestion.last_run_items} itens · {formatDateTime(ingestion.last_run_at)}
          </p>
          {!ok && ingestion.last_run_status && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-2">
              <AlertTriangle size={12} />
              Última run com status: {ingestion.last_run_status}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ── Secção: Timeline ────────────────────────────────────────────

function TimelineCard({ runs, loading }: { runs: any[]; loading: boolean }) {
  if (loading) return (
    <SectionCard title="Histórico de Ingestões" padding={false}>
      <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
    </SectionCard>
  );

  return (
    <SectionCard title="Histórico de Ingestões" padding={false}
      actions={
        <Link to="/ingestion-runs" className="text-xs text-vivere-teal hover:underline flex items-center gap-1">
          Ver todos <ArrowRight size={11} />
        </Link>
      }>
      {runs.length === 0 ? (
        <div className="p-4 text-sm text-gray-400 italic">Sem ingestões registadas</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              {['Source', 'Status', 'Itens', 'Erros', 'Início'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {runs.map(run => (
              <tr key={run.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{sourceLabel(run.source_key)}</td>
                <td className="px-4 py-3">
                  {run.status === 'success'
                    ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={12} /> success</span>
                    : run.status === 'running'
                    ? <span className="flex items-center gap-1 text-yellow-500 text-xs"><Zap size={12} /> running</span>
                    : <span className="flex items-center gap-1 text-red-600 text-xs"><XCircle size={12} /> {run.status}</span>
                  }
                </td>
                <td className="px-4 py-3 text-gray-600">{run.items_collected}</td>
                <td className="px-4 py-3">
                  {run.items_errored > 0
                    ? <span className="text-red-500 text-xs">{run.items_errored}</span>
                    : <span className="text-gray-300 text-xs">0</span>
                  }
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{timeAgo(run.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

// ── Dashboard principal ────────────────────────────────────────

export function DashboardPage() {
  const { productKey } = useOutletContext<AppOutletContext>();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats', productKey],
    queryFn:  () => StatsService.getStats(productKey),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['ingestion-runs-dashboard'],
    queryFn:  () => StatsService.getIngestionRuns(5),
    refetchInterval: 30_000,
  });

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-vivere-dark">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-0.5">{productKey} · Centro de operações</p>
      </div>

      {/* W1–W4: Review Queue */}
      <ReviewQueue stats={stats} loading={statsLoading} />

      {/* W11 + W8: Quick Actions + Budget */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <QuickActions stats={stats} />
        <BudgetCard budget={stats?.budget} loading={statsLoading} />
      </div>

      {/* W5 + W6: Última ingestão + Estado das sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LastRunCard ingestion={stats?.ingestion} loading={statsLoading} />
        <SourcesCard sources={stats?.ingestion.by_source ?? []} loading={statsLoading} />
      </div>

      {/* W7: Timeline */}
      <TimelineCard runs={runs} loading={runsLoading} />

      {/* W9: API Status — simples, sem verificação real de DB até Fase B.2 */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
        Review API online · v0.1.0
        <span className="mx-2">·</span>
        <Clock size={11} />
        <span>Actualiza a cada 30s</span>
      </div>
    </div>
  );
}
