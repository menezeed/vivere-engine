import { apiRequest } from '@/api/client';
import type { ActivityStagingItem } from '@/types/activity';
import type { ListResponse } from '@/types/api';
import type { ProposalStatus } from '@/types/review';

export interface ActivityListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ProposalStatus;
  product_key?: string;
  venue_resolution?: string;
  source?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const ActivityService = {
  async list(params: ActivityListParams = {}): Promise<ListResponse<ActivityStagingItem>> {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) qs.set(k, String(v)); });
    return apiRequest<ListResponse<ActivityStagingItem>>(`/api/activities?${qs}`);
  },

  async get(id: string): Promise<ActivityStagingItem> {
    const res = await apiRequest<{ data: ActivityStagingItem }>(`/api/activities/${id}`);
    return res.data;
  },

  async approve(id: string): Promise<void> {
    await apiRequest(`/api/activities/${id}/approve`, { method: 'PATCH' });
  },

  async reject(id: string): Promise<void> {
    await apiRequest(`/api/activities/${id}/reject`, { method: 'PATCH' });
  },

  async promote(id: string): Promise<void> {
    await apiRequest(`/api/activities/${id}/promote`, { method: 'PATCH' });
  },
};
