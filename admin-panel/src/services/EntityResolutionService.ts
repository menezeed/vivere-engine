// admin-panel/src/services/EntityResolutionService.ts

import { apiRequest } from '@/api/client';
import type { ListResponse } from '@/types/api';
import type { ERQueueItem, ERCandidate, ERStats } from '@/types/entityResolution';

export const EntityResolutionService = {
  async getQueue(params: {
    product_key: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ListResponse<ERQueueItem>> {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) qs.set(k, String(v)); });
    return apiRequest<ListResponse<ERQueueItem>>(`/api/entity-resolution/queue?${qs}`);
  },

  async getCandidates(activityId: string): Promise<ERCandidate[]> {
    const res = await apiRequest<{ data: ERCandidate[] }>(
      `/api/entity-resolution/${activityId}/candidates`,
    );
    return res.data;
  },

  async accept(activityId: string, candidateId: string, notes?: string): Promise<void> {
    await apiRequest(`/api/entity-resolution/${activityId}/accept`, {
      method: 'PATCH',
      body: JSON.stringify({ candidateId, notes: notes ?? null }),
    });
  },

  async override(activityId: string, candidateId: string, notes: string): Promise<void> {
    await apiRequest(`/api/entity-resolution/${activityId}/override`, {
      method: 'PATCH',
      body: JSON.stringify({ candidateId, notes }),
    });
  },

  async proposeNew(activityId: string, notes?: string): Promise<void> {
    await apiRequest(`/api/entity-resolution/${activityId}/propose-new`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: notes ?? null }),
    });
  },

  async getStats(productKey: string): Promise<ERStats> {
    const res = await apiRequest<{ data: ERStats }>(
      `/api/entity-resolution/stats?product_key=${productKey}`,
    );
    return res.data;
  },
};
