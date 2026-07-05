import { apiRequest } from '@/api/client';
import type { PlatformStats, IngestionRun } from '@/types/stats';

export const StatsService = {
  async getStats(productKey?: string): Promise<PlatformStats> {
    const qs = productKey ? `?product_key=${productKey}` : '';
    return apiRequest<PlatformStats>(`/api/stats${qs}`);
  },

  async getIngestionRuns(limit = 10): Promise<IngestionRun[]> {
    const res = await apiRequest<{ data: IngestionRun[] }>(`/api/ingestion-runs?limit=${limit}`);
    return res.data;
  },
};
