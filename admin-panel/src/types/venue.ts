import type { ProposalStatus } from './review';

export interface VenueStagingItem {
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
  // Campos do raw — presentes na listagem (sem raw_payload)
  name?: string;
  address?: string;
  city?: string;
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
  // Apenas no detalhe
  raw_payload?: Record<string, unknown>;
}
// VenueListResponse removido — usar ListResponse<VenueStagingItem> de @/types/api
