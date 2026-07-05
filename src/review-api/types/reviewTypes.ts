export type UserRole = 'viewer' | 'reviewer' | 'admin';
export type ProposalStatus = 'pending_review' | 'approved' | 'rejected' | 'promoted';
export type ReviewAction = 'approve' | 'reject' | 'promote';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface ReviewFilter {
  status?: ProposalStatus;
  product_key?: string;
  limit?: number;
  offset?: number;
  search?: string;
}

/**
 * Row retornada pelo list — campos seleccionados para a tabela.
 * Inclui JOIN com raw_venue_items mas SEM raw_payload (performance).
 */
export interface VenueStagingRow {
  id: string;
  raw_venue_item_id: string;
  source_key: string;
  source_item_id: string;
  product_key: string;
  proposal_status: ProposalStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  promoted_at: string | null;
  promoted_venue_id: string | null;
  created_at: string;
  // Campos do raw (JOIN na listagem — sem raw_payload)
  name?: string;
  address?: string;
  city?: string;           // derivada do endereço quando possível
  lat?: number;
  lng?: number;
  phone?: string | null;
  website?: string | null;
  image_url?: string | null;
  google_types?: string[];
  google_business_status?: string | null;
  source_category_hint?: string;
  source_query_text?: string;
  source_query_kind?: string;
  opening_hours_raw?: string | null;
}

/**
 * Row do detalhe — inclui raw_payload completo para Filtering Decision
 * e accordion de payload bruto.
 */
export interface VenueStagingDetail extends VenueStagingRow {
  raw_payload?: Record<string, unknown>;
}

export interface ActivityStagingRow {
  id: string;
  raw_activity_item_id: string;
  product_key: string;
  proposal_status: ProposalStatus;
  venue_resolution_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  promoted_at: string | null;
  promoted_activity_id: string | null;
  created_at: string;
  // Campos do raw
  title?: string;
  description?: string | null;
  venue_mention_raw_text?: string | null;
  venue_mention_confidence_hint?: string | null;
  occurrences?: Array<{ date: string; time: string | null; end_date: string | null; end_time: string | null }>;
  source_key?: string;
  image_url?: string | null;
  external_url?: string | null;
  raw_payload?: Record<string, unknown>;
}

export interface ReviewContext {
  action: ReviewAction;
  reviewedBy: string;
  notes?: string;
}

export const ALLOWED_TRANSITIONS: Record<ProposalStatus, Partial<Record<ReviewAction, ProposalStatus>>> = {
  pending_review: { approve: 'approved', reject: 'rejected' },
  approved:       { promote: 'promoted', reject: 'rejected' },
  rejected:       {},
  promoted:       {},
};

export const ACTION_ROLES: Record<ReviewAction, UserRole[]> = {
  approve:  ['reviewer', 'admin'],
  reject:   ['reviewer', 'admin'],
  promote:  ['admin'],
};

/**
 * Payload rico do endpoint GET /api/stats.
 * Todo cálculo acontece no backend — o frontend apenas renderiza.
 */
export interface PlatformStats {
  venues: {
    pending_review: number;
    approved: number;
    rejected: number;
    promoted: number;
    total: number;
  };
  activities: {
    pending_review: number;
    approved: number;
    rejected: number;
    promoted: number;
    total: number;
  };
  ingestion: {
    last_run_at: string | null;
    last_run_source: string | null;
    last_run_items: number | null;
    runs_this_month: number;
  };
  budget: {
    monthly_limit_usd: number;
    estimated_spent_usd: number;
    estimated_remaining_usd: number;
    usage_pct: number;
    alert: boolean;
  };
}
