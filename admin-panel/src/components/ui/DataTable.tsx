import type { ReactNode } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

// ── Tipos ────────────────────────────────────────────────────────

export interface ColumnDef<T> {
  key: string;
  header: string;
  width?: string;                          // ex: 'w-48', 'w-24'
  sortable?: boolean;
  render: (row: T, index: number) => ReactNode;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  isLoading?: boolean;
  skeletonRows?: number;
  emptyTitle?: string;
  emptyMessage?: string;
  // Selecção
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  // Ordenação
  sortKey?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (key: string, order: 'asc' | 'desc') => void;
  // Linha clicável
  onRowClick?: (row: T) => void;
}

// ── Skeleton ─────────────────────────────────────────────────────

function SkeletonRow({ cols, selectable }: { cols: number; selectable: boolean }) {
  return (
    <tr>
      {selectable && <td className="px-4 py-3 w-10"><div className="h-4 w-4 bg-gray-200 rounded animate-pulse" /></td>}
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: `${60 + (i * 17) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ── Sort icon ────────────────────────────────────────────────────

function SortIcon({ col, sortKey, sortOrder }: { col: string; sortKey?: string; sortOrder?: 'asc' | 'desc' }) {
  if (col !== sortKey) return <ChevronsUpDown size={12} className="text-gray-300" />;
  return sortOrder === 'asc'
    ? <ChevronUp size={12} className="text-vivere-teal" />
    : <ChevronDown size={12} className="text-vivere-teal" />;
}

// ── DataTable ────────────────────────────────────────────────────

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  skeletonRows = 5,
  emptyTitle = 'Nenhum resultado',
  emptyMessage,
  selectable = false,
  selectedIds = new Set(),
  onSelectionChange,
  sortKey,
  sortOrder,
  onSort,
  onRowClick,
}: DataTableProps<T>) {
  const allIds = data.map(keyExtractor);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const someSelected = allIds.some(id => selectedIds.has(id));

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      const next = new Set(selectedIds);
      allIds.forEach(id => next.delete(id));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIds);
      allIds.forEach(id => next.add(id));
      onSelectionChange(next);
    }
  }

  function toggleRow(id: string) {
    if (!onSelectionChange) return;
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    onSelectionChange(next);
  }

  function handleSort(col: ColumnDef<T>) {
    if (!col.sortable || !onSort) return;
    const next = col.key === sortKey && sortOrder === 'asc' ? 'desc' : 'asc';
    onSort(col.key, next);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              {selectable && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-vivere-teal focus:ring-vivere-teal"
                  />
                </th>
              )}
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide ${col.width ?? ''} ${col.sortable ? 'cursor-pointer select-none hover:text-gray-600' : ''}`}
                  onClick={() => handleSort(col)}
                >
                  <div className="flex items-center gap-1.5">
                    {col.header}
                    {col.sortable && <SortIcon col={col.key} sortKey={sortKey} sortOrder={sortOrder} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <SkeletonRow key={i} cols={columns.length} selectable={selectable} />
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="py-16 text-center">
                  <p className="text-gray-400 font-medium">{emptyTitle}</p>
                  {emptyMessage && <p className="text-sm text-gray-300 mt-1">{emptyMessage}</p>}
                </td>
              </tr>
            ) : (
              data.map((row, index) => {
                const id = keyExtractor(row);
                const selected = selectedIds.has(id);
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    className={`transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${selected ? 'bg-teal-50' : 'hover:bg-gray-50'}`}
                  >
                    {selectable && (
                      <td className="px-4 py-3 w-10" onClick={e => { e.stopPropagation(); toggleRow(id); }}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleRow(id)}
                          className="rounded border-gray-300 text-vivere-teal focus:ring-vivere-teal"
                        />
                      </td>
                    )}
                    {columns.map(col => (
                      <td key={col.key} className={`px-4 py-3 ${col.width ?? ''}`}>
                        {col.render(row, index)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

