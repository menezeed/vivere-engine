import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ── PageHeader ───────────────────────────────────────────────────

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  badge?: ReactNode;
}

export function PageHeader({ title, subtitle, actions, badge }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-vivere-dark">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ── StatCard ─────────────────────────────────────────────────────

type Trend = 'up' | 'down' | 'neutral';

export interface StatCardProps {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  iconColor?: string;      // tailwind text color, ex: 'text-teal-600'
  iconBg?: string;         // tailwind bg color, ex: 'bg-teal-50'
  trend?: Trend;
  trendLabel?: string;
  accent?: boolean;
  onClick?: () => void;
  loading?: boolean;
}

const TREND_ICON = { up: TrendingUp, down: TrendingDown, neutral: Minus };
const TREND_COLOR = { up: 'text-green-600', down: 'text-red-500', neutral: 'text-gray-400' };

export function StatCard({
  label, value, icon: Icon, iconColor = 'text-vivere-teal', iconBg = 'bg-teal-50',
  trend, trendLabel, accent, onClick, loading,
}: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-gray-200 p-5 transition-all ${onClick ? 'cursor-pointer hover:border-vivere-teal hover:shadow-sm' : ''}`}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
        {Icon && (
          <div className={`p-2 rounded-lg ${iconBg}`}>
            <Icon size={15} className={iconColor} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-20 bg-gray-200 rounded animate-pulse" />
      ) : (
        <p className={`text-3xl font-bold ${accent ? 'text-vivere-teal' : 'text-vivere-dark'}`}>{value}</p>
      )}
      {(trend || trendLabel) && !loading && (
        <div className={`flex items-center gap-1 mt-2 ${trend ? TREND_COLOR[trend] : 'text-gray-400'}`}>
          {trend && (() => { const T = TREND_ICON[trend]; return <T size={12} />; })()}
          {trendLabel && <span className="text-xs">{trendLabel}</span>}
        </div>
      )}
    </div>
  );
}

// ── SectionCard ──────────────────────────────────────────────────

export interface SectionCardProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  padding?: boolean;
}

export function SectionCard({ title, subtitle, actions, children, padding = true }: SectionCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {(title || actions) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            {title && <p className="text-sm font-semibold text-gray-700">{title}</p>}
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padding ? 'p-5' : ''}>{children}</div>
    </div>
  );
}
