/**
 * Tipos internos da Human Review API.
 * Distintos dos tipos da engine de ingestão — representam o domínio
 * de revisão humana, não o domínio de coleta.
 */

export type UserRole = 'viewer' | 'reviewer' | 'admin';

export type ProposalStatus = 'pending_review' | 'approved' | 'rejected' | 'promoted';

export type ReviewAction = 'approve' | 'reject' | 'promote';

/** Usuário autenticado extraído do JWT pelo middleware de auth. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

/** Filtros para listagem de filas de revisão. */
export interface ReviewFilter {
  status?: ProposalStatus;
  product_key?: string;
  limit?: number;
  offset?: number;
}

/** Row de venues_staging retornada pelos repositórios de revisão. */
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
  // Campos do raw_venue_item via JOIN (opcionais — presentes só em getById)
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  phone?: string | null;
  website?: string | null;
  google_types?: string[];
  source_category_hint?: string;
}

/** Row de activities_staging retornada pelos repositórios de revisão. */
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
  // Campos do raw_activity_item via JOIN (opcionais — presentes só em getById)
  title?: string;
  description?: string | null;
  venue_mention_raw_text?: string | null;
}

/** Contexto passado para cada ação de revisão. */
export interface ReviewContext {
  action: ReviewAction;
  reviewedBy: string;
  notes?: string;
}

/**
 * Mapa de transições de status permitidas.
 * Chave: status atual. Valor: ações permitidas e o status resultante.
 */
export const ALLOWED_TRANSITIONS: Record<ProposalStatus, Partial<Record<ReviewAction, ProposalStatus>>> = {
  pending_review: {
    approve: 'approved',
    reject:  'rejected',
  },
  approved: {
    promote: 'promoted',
    reject:  'rejected',
  },
  rejected: {
    // Rejeitado é terminal — sem transições permitidas via API
  },
  promoted: {
    // Promovido é terminal — sem transições permitidas via API
  },
};

/** Roles que podem executar cada ação. */
export const ACTION_ROLES: Record<ReviewAction, UserRole[]> = {
  approve:  ['reviewer', 'admin'],
  reject:   ['reviewer', 'admin'],
  promote:  ['admin'],
};
