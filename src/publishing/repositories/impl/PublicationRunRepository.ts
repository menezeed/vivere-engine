/**
 * src/publishing/repositories/impl/PublicationRunRepository.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublicationRunRepository } from '../interfaces.js';
import type {
  PublicationRunId,
  PublicationRunSummary,
  PublicationRunMetrics,
} from '../../types/domain.js';

export class PublicationRunRepository implements IPublicationRunRepository {
  constructor(private readonly db: SupabaseClient) {}

  async start(productKey: string, triggeredBy: string): Promise<PublicationRunId> {
    const { data, error } = await this.db
      .from('publication_runs')
      .insert({ product_key: productKey, triggered_by: triggeredBy, status: 'running' })
      .select('id')
      .single();

    if (error || !data) throw new Error(`PublicationRunRepository.start: ${error?.message ?? 'no data'}`);
    return data.id as PublicationRunId;
  }

  async finish(runId: PublicationRunId, metrics: PublicationRunMetrics): Promise<void> {
    const { error } = await this.db
      .from('publication_runs')
      .update({
        // Bugfix (Sprint 8.6): status deriva de metrics.errors, já recebido
        // como parâmetro. Antes gravava sempre 'success', impossibilitando
        // distinguir runs 'partial'.
        status:               metrics.errors > 0 ? 'partial' : 'success',
        finished_at:          new Date().toISOString(),
        duration_ms:          metrics.durationMs,
        venues_published:     metrics.venuesPublished,
        venues_updated:       metrics.venuesUpdated,
        venues_skipped:       metrics.venuesSkipped,
        venues_archived:      metrics.venuesArchived,
        activities_published: metrics.activitiesPublished,
        activities_updated:   metrics.activitiesUpdated,
        activities_skipped:   metrics.activitiesSkipped,
        activities_archived:  metrics.activitiesArchived,
        errors:               metrics.errors,
      })
      .eq('id', runId);

    if (error) throw new Error(`PublicationRunRepository.finish: ${error.message}`);
  }

  async markFailed(runId: PublicationRunId, reason: string): Promise<void> {
    const { error } = await this.db
      .from('publication_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), notes: reason })
      .eq('id', runId);

    if (error) throw new Error(`PublicationRunRepository.markFailed: ${error.message}`);
  }

  async findActive(productKey: string): Promise<PublicationRunSummary | null> {
    const { data, error } = await this.db
      .from('publication_runs')
      .select('*')
      .eq('product_key', productKey)
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`PublicationRunRepository.findActive: ${error.message}`);
    return data ? this.toSummary(data) : null;
  }

  async findLastCompleted(productKey: string): Promise<PublicationRunSummary | null> {
    const { data, error } = await this.db
      .from('publication_runs')
      .select('*')
      .eq('product_key', productKey)
      .in('status', ['success', 'partial'])
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`PublicationRunRepository.findLastCompleted: ${error.message}`);
    return data ? this.toSummary(data) : null;
  }

  private toSummary(row: Record<string, unknown>): PublicationRunSummary {
    return {
      runId:       row['id'] as PublicationRunId,
      productKey:  row['product_key'] as string,
      triggeredBy: row['triggered_by'] as string,
      status:      row['status'] as PublicationRunSummary['status'],
      startedAt:   new Date(row['started_at'] as string),
      finishedAt:  row['finished_at'] ? new Date(row['finished_at'] as string) : null,
      metrics:     row['venues_published'] != null ? {
        venuesPublished:      Number(row['venues_published'])     ?? 0,
        venuesUpdated:        Number(row['venues_updated'])       ?? 0,
        venuesSkipped:        Number(row['venues_skipped'])       ?? 0,
        venuesArchived:       Number(row['venues_archived'])      ?? 0,
        activitiesPublished:  Number(row['activities_published']) ?? 0,
        activitiesUpdated:    Number(row['activities_updated'])   ?? 0,
        activitiesSkipped:    Number(row['activities_skipped'])   ?? 0,
        activitiesArchived:   Number(row['activities_archived'])  ?? 0,
        errors:               Number(row['errors'])               ?? 0,
        durationMs:           Number(row['duration_ms'])          ?? 0,
      } : null,
    };
  }
}
