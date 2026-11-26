import { apiRequest } from '@/api/client';
import type { ActivityStagingItem } from '@/types/activity';
import type { ListResponse } from '@/types/api';
import type { ProposalStatus } from '@/types/review';
import type { EligibilityReview, EligibilityReviewInput } from '@/types/eligibility';

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
  /** Issue #62: classe de elegibilidade 60+ (filtrada no servidor). */
  eligibility?: string;
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

  /** Issue #62: trilha de auditoria das revisões de elegibilidade 60+. */
  async listEligibilityReviews(id: string): Promise<EligibilityReview[]> {
    const res = await apiRequest<{ data: EligibilityReview[] }>(`/api/activities/${id}/eligibility-reviews`);
    return res.data;
  },

  /** Issue #62: regista uma classificação fundamentada (não aprova). */
  async submitEligibilityReview(id: string, input: EligibilityReviewInput): Promise<EligibilityReview> {
    const res = await apiRequest<{ data: EligibilityReview }>(`/api/activities/${id}/eligibility-reviews`, {
      method: 'POST', body: JSON.stringify(input),
    });
    return res.data;
  },
};
