import type { ProposalStatus } from '@/types/review';
import type { GeographicStatus } from '@/types/venue';
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

/**
 * ADR-0022 (Regional Geographic Gate) — mesmo padrão de badge dos
 * outros três acima (mapa estático + Badge genérico). Devolve null
 * quando geographic_status é null (fonte sem região, ou linha
 * anterior à ADR-0022) — não renderiza nada em vez de um badge vazio.
 */
const GEOGRAPHIC_STATUS_MAP: Record<GeographicStatus, { label: string; variant: 'green' | 'yellow' | 'red' }> = {
  inside_radius:  { label: 'Dentro da região',  variant: 'green'  },
  buffer_zone:    { label: '⚠ Margem',          variant: 'yellow' },
  outside_region: { label: '⚠ Fora da região',  variant: 'red'    },
};

export function GeographicStatusBadge({ status }: { status: GeographicStatus | null | undefined }) {
  if (!status) return null;
  const { label, variant } = GEOGRAPHIC_STATUS_MAP[status];
  return <Badge variant={variant}>{label}</Badge>;
}
