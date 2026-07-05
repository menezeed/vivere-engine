import { CheckSquare, XSquare, ChevronDown } from 'lucide-react';

export interface BulkActionsProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  // Acções disponíveis — desactivadas até batch API existir
  onApproveSelected?: () => void;
  onRejectSelected?: () => void;
  batchEnabled?: boolean;   // false por defeito até PATCH /api/venues/batch existir
}

export function BulkActions({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onApproveSelected,
  onRejectSelected,
  batchEnabled = false,
}: BulkActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-vivere-dark rounded-lg text-white text-sm">
      {/* Contagem */}
      <div className="flex items-center gap-2">
        <CheckSquare size={15} className="text-vivere-teal" />
        <span className="font-medium">{selectedCount} seleccionado{selectedCount !== 1 ? 's' : ''}</span>
        <span className="text-white/40">de {totalCount}</span>
      </div>

      <div className="h-4 w-px bg-white/20" />

      {/* Selecionar todos */}
      {selectedCount < totalCount && (
        <button
          onClick={onSelectAll}
          className="text-white/70 hover:text-white text-xs transition-colors"
        >
          Seleccionar todos ({totalCount})
        </button>
      )}

      <button
        onClick={onClearSelection}
        className="text-white/50 hover:text-white text-xs transition-colors flex items-center gap-1"
      >
        <XSquare size={12} />
        Limpar
      </button>

      <div className="h-4 w-px bg-white/20" />

      {/* Acções em massa — desactivadas até batch API existir */}
      {batchEnabled ? (
        <>
          <button
            onClick={onApproveSelected}
            className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-xs font-medium transition-colors"
          >
            Aprovar seleccionados
          </button>
          <button
            onClick={onRejectSelected}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs font-medium transition-colors"
          >
            Rejeitar seleccionados
          </button>
        </>
      ) : (
        <div className="relative group">
          <button
            disabled
            className="flex items-center gap-1.5 px-3 py-1 bg-white/10 rounded text-xs text-white/40 cursor-not-allowed"
          >
            Acções em massa
            <ChevronDown size={11} />
          </button>
          {/* Tooltip */}
          <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-10">
            <div className="bg-gray-900 text-white text-xs px-3 py-1.5 rounded whitespace-nowrap">
              Disponível quando batch API estiver implementada
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
