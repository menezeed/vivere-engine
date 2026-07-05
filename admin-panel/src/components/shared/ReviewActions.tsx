import type { ProposalStatus, ReviewAction } from '@/types/review';

interface ReviewActionsProps {
  status: ProposalStatus;
  onAction: (action: ReviewAction) => void;
  isLoading?: boolean;
  compact?: boolean;
}

const ACTIONS_BY_STATUS: Record<ProposalStatus, ReviewAction[]> = {
  pending_review: ['approve', 'reject'],
  approved:       ['promote', 'reject'],
  rejected:       [],
  promoted:       [],
};

const ACTION_CONFIG: Record<ReviewAction, { label: string; className: string }> = {
  approve: { label: 'Aprovar',  className: 'bg-green-600 hover:bg-green-700 text-white' },
  reject:  { label: 'Rejeitar', className: 'bg-red-600 hover:bg-red-700 text-white'     },
  promote: { label: 'Promover', className: 'bg-blue-600 hover:bg-blue-700 text-white'   },
};

export function ReviewActions({ status, onAction, isLoading, compact }: ReviewActionsProps) {
  const actions = ACTIONS_BY_STATUS[status];
  if (actions.length === 0) return null;

  return (
    <div className="flex gap-2" onClick={e => e.stopPropagation()}>
      {actions.map((action) => {
        const { label, className } = ACTION_CONFIG[action];
        return (
          <button
            key={action}
            onClick={() => onAction(action)}
            disabled={isLoading}
            className={`${compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} rounded font-medium transition-colors disabled:opacity-50 cursor-pointer ${className}`}
          >
            {isLoading ? '…' : label}
          </button>
        );
      })}
    </div>
  );
}
