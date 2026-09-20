import { apiRequest } from '@/api/client';
import type { VenueStagingItem, GeographicStatus } from '@/types/venue';
import type { ListResponse } from '@/types/api';
import type { ProposalStatus } from '@/types/review';

export interface VenueListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ProposalStatus;
  product_key?: string;
  city?: string;
  category?: string;
  source?: string;
  /** ADR-0022 — dimensão independente de status (proposal_status). */
  geographic_status?: GeographicStatus;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const VenueService = {
  async list(params: VenueListParams = {}): Promise<ListResponse<VenueStagingItem>> {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) qs.set(k, String(v)); });
    return apiRequest<ListResponse<VenueStagingItem>>(`/api/venues?${qs}`);
  },

  async get(id: string): Promise<VenueStagingItem> {
    const res = await apiRequest<{ data: VenueStagingItem }>(`/api/venues/${id}`);
    return res.data;
  },

  async approve(id: string): Promise<void> {
    await apiRequest(`/api/venues/${id}/approve`, { method: 'PATCH' });
  },

  async reject(id: string): Promise<void> {
    await apiRequest(`/api/venues/${id}/reject`, { method: 'PATCH' });
  },

  async promote(id: string): Promise<void> {
    await apiRequest(`/api/venues/${id}/promote`, { method: 'PATCH' });
  },
};
