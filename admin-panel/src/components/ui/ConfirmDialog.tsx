import type { ReactNode } from 'react';
import { AlertTriangle, Info, CheckCircle } from 'lucide-react';

type DialogVariant = 'danger' | 'warning' | 'info' | 'success';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_CONFIG: Record<DialogVariant, {
  icon: typeof AlertTriangle;
  iconClass: string;
  confirmClass: string;
}> = {
  danger:  { icon: AlertTriangle, iconClass: 'text-red-500 bg-red-50',    confirmClass: 'bg-red-600 hover:bg-red-700 text-white' },
  warning: { icon: AlertTriangle, iconClass: 'text-amber-500 bg-amber-50', confirmClass: 'bg-amber-600 hover:bg-amber-700 text-white' },
  info:    { icon: Info,          iconClass: 'text-blue-500 bg-blue-50',   confirmClass: 'bg-blue-600 hover:bg-blue-700 text-white' },
  success: { icon: CheckCircle,   iconClass: 'text-green-500 bg-green-50', confirmClass: 'bg-vivere-teal hover:bg-teal-700 text-white' },
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'warning',
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  const { icon: Icon, iconClass, confirmClass } = VARIANT_CONFIG[variant];

  return (
    // Overlay
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={e => e.stopPropagation()}
      >
        {/* Ícone */}
        <div className={`inline-flex p-3 rounded-full mb-4 ${iconClass}`}>
          <Icon size={22} />
        </div>

        {/* Conteúdo */}
        <h2 className="text-lg font-bold text-vivere-dark mb-2">{title}</h2>
        <div className="text-sm text-gray-500 leading-relaxed mb-6">{message}</div>

        {/* Acções */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${confirmClass}`}
          >
            {isLoading ? 'A processar...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
