import type { ProposalStatus } from '@/types/review';
import { Badge } from '@/components/ui/index';

const STATUS_MAP: Record<ProposalStatus, { label: string; variant: 'yellow' | 'green' | 'red' | 'blue' }> = {
  pending_review: { label: 'Pendente',  variant: 'yellow' },
  approved:       { label: 'Aprovado',  variant: 'green'  },
  rejected:       { label: 'Rejeitado', variant: 'red'    },
  promoted:       { label: 'Promovido', variant: 'blue'   },
};

export function StatusBadge({ status }: { status: ProposalStatus }) {
  const { label, variant } = STATUS_MAP[status];
  return <Badge variant={variant}>{label}</Badge>;
}

const RESOLUTION_MAP: Record<string, { label: string; variant: 'green' | 'yellow' | 'gray' | 'purple' }> = {
  matched:      { label: '✓ Resolvido',     variant: 'green'  },
  ambiguous:    { label: '⚠ Ambíguo',       variant: 'yellow' },
  unresolved:   { label: '○ Não resolvido', variant: 'gray'   },
  proposed_new: { label: '+ Novo proposto', variant: 'purple' },
};

export function VenueResolutionBadge({ status }: { status: string }) {
  const cfg = RESOLUTION_MAP[status] ?? { label: status, variant: 'gray' as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export function SourceBadge({ sourceKey }: { sourceKey: string }) {
  const labels: Record<string, string> = {
    google_places:         'Google Places',
    prefeitura_cabo_frio:  'Prefeitura CF',
  };
  return <Badge variant="default">{labels[sourceKey] ?? sourceKey}</Badge>;
}
