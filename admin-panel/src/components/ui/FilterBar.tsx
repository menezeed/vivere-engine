import { Search, X, SlidersHorizontal } from 'lucide-react';

// ── Tipos ────────────────────────────────────────────────────────

export type FilterType = 'search' | 'select' | 'badge';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDef {
  key: string;
  label: string;
  type: FilterType;
  placeholder?: string;
  options?: FilterOption[];   // para type='select' ou 'badge'
  width?: string;             // ex: 'w-40'
}

export interface FilterValues {
  [key: string]: string | undefined;
}

export interface FilterBarProps {
  filters: FilterDef[];
  values: FilterValues;
  onChange: (key: string, value: string | undefined) => void;
  onClearAll?: () => void;
}

// ── FilterBar ────────────────────────────────────────────────────

export function FilterBar({ filters, values, onChange, onClearAll }: FilterBarProps) {
  const hasActiveFilters = Object.values(values).some(v => v && v !== '');

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5 text-gray-400">
        <SlidersHorizontal size={14} />
        <span className="text-xs font-medium uppercase tracking-wide">Filtros</span>
      </div>

      {filters.map(filter => {
        const value = values[filter.key] ?? '';

        if (filter.type === 'search') {
          return (
            <div key={filter.key} className={`relative ${filter.width ?? 'w-56'}`}>
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={filter.placeholder ?? `Pesquisar ${filter.label.toLowerCase()}...`}
                value={value}
                onChange={e => onChange(filter.key, e.target.value || undefined)}
                className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-vivere-teal focus:border-transparent bg-white"
              />
              {value && (
                <button onClick={() => onChange(filter.key, undefined)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={12} />
                </button>
              )}
            </div>
          );
        }

        if (filter.type === 'select') {
          return (
            <div key={filter.key} className={`relative ${filter.width ?? 'w-40'}`}>
              <select
                value={value}
                onChange={e => onChange(filter.key, e.target.value || undefined)}
                className={`w-full py-1.5 pl-3 pr-8 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-vivere-teal focus:border-transparent bg-white appearance-none ${value ? 'border-vivere-teal text-vivere-teal' : 'border-gray-200 text-gray-500'}`}
              >
                <option value="">{filter.label}</option>
                {filter.options?.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {value && (
                <button onClick={() => onChange(filter.key, undefined)}
                  className="absolute right-7 top-1/2 -translate-y-1/2 text-vivere-teal hover:text-teal-700">
                  <X size={11} />
                </button>
              )}
            </div>
          );
        }

        if (filter.type === 'badge') {
          return (
            <div key={filter.key} className="flex gap-1">
              {filter.options?.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onChange(filter.key, value === opt.value ? undefined : opt.value)}
                  className={`px-3 py-1.5 text-xs rounded-full border font-medium transition-colors ${
                    value === opt.value
                      ? 'bg-vivere-teal border-vivere-teal text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          );
        }

        return null;
      })}

      {hasActiveFilters && onClearAll && (
        <button
          onClick={onClearAll}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={12} />
          Limpar filtros
        </button>
      )}
    </div>
  );
}
