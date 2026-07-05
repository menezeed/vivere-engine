import { Outlet, NavLink, useOutletContext } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useQuery } from '@tanstack/react-query';
import { StatsService } from '@/services/StatsService';
import { LayoutDashboard, MapPin, Calendar, Activity, LogOut, ChevronDown, Settings } from 'lucide-react';
import { useState } from 'react';

const PRODUCTS = [
  { key: 'vivere-60-mais', label: 'Vivere 60+' },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const [selectedProduct, setSelectedProduct] = useState(PRODUCTS[0]);
  const [productOpen, setProductOpen] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['stats', selectedProduct.key],
    queryFn: () => StatsService.getStats(selectedProduct.key),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const NAV = [
    { to: '/dashboard',      label: 'Dashboard',   icon: LayoutDashboard, count: null },
    { to: '/venues',         label: 'Venues',      icon: MapPin,          count: stats?.venues.pending_review ?? null },
    { to: '/activities',     label: 'Actividades', icon: Calendar,        count: stats?.activities.pending_review ?? null },
    { to: '/ingestion-runs', label: 'Ingestões',   icon: Activity,        count: null },
    { to: '/settings',       label: 'Settings',    icon: Settings,        count: null },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-vivere-dark flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-white/10">
          <p className="text-white font-bold text-lg tracking-tight">Vivere</p>
          <p className="text-white/40 text-xs">Admin Panel</p>
        </div>

        {/* Product selector */}
        <div className="px-3 py-3 border-b border-white/10">
          <button
            onClick={() => setProductOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 rounded bg-white/5 text-white/80 text-sm hover:bg-white/10 transition-colors"
          >
            <span>{selectedProduct.label}</span>
            <ChevronDown size={14} className={`transition-transform ${productOpen ? 'rotate-180' : ''}`} />
          </button>
          {productOpen && (
            <div className="mt-1 rounded bg-white/10 overflow-hidden">
              {PRODUCTS.map(p => (
                <button
                  key={p.key}
                  onClick={() => { setSelectedProduct(p); setProductOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, count }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-vivere-teal text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <span className="flex items-center gap-2.5">
                <Icon size={15} />
                {label}
              </span>
              {count !== null && count > 0 && (
                <span className="bg-white/20 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {count}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="px-3 py-4 border-t border-white/10">
          <p className="text-white/50 text-xs truncate mb-2">{user?.email}</p>
          <p className="text-white/30 text-xs mb-3 capitalize">{user?.role}</p>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-white/40 hover:text-white text-sm transition-colors"
          >
            <LogOut size={13} />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet context={{ productKey: selectedProduct.key }} />
      </main>
    </div>
  );
}
