/**
 * entity-resolution/repositories/impl/VenueResolutionRunRepository.ts
 *
 * Implementação concreta de IVenueResolutionRunRepository para Supabase.
 *
 * Responsabilidade: persistência do ciclo de vida de uma run ER.
 * Zero lógica de matching, scoring ou algoritmo.
 * Mesmo padrão de IIngestionRunRepository da engine de ingestão.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IVenueResolutionRunRepository } from '../interfaces.js';
import type { ResolutionRunId, ResolutionRunSummary } from '../../types/domain.js';
import { RepositoryError } from '../../errors/index.js';

const TABLE  = 'venue_resolution_runs';
const SCHEMA = 'staging';

export class VenueResolutionRunRepository implements IVenueResolutionRunRepository {
  constructor(private readonly db: SupabaseClient) {}

  async start(productKey: string, triggeredBy: string): Promise<ResolutionRunId> {
    const { data, error } = await this.db
      .schema(SCHEMA)
      .from(TABLE)
      .insert({
        product_key:  productKey,
        triggered_by: triggeredBy,
        status:       'running',
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new RepositoryError('insert', TABLE, error?.message ?? 'no data returned');
    }

    return data.id as ResolutionRunId;
  }

  async finish(
    runId: ResolutionRunId,
    stats: { activitiesProcessed: number; candidatesGenerated: number },
  ): Promise<void> {
    const { error } = await this.db
      .schema(SCHEMA)
      .from(TABLE)
      .update({
        status:               'success',
        finished_at:          new Date().toISOString(),
        activities_processed: stats.activitiesProcessed,
        candidates_generated: stats.candidatesGenerated,
      })
      .eq('id', runId);

    if (error) {
      throw new RepositoryError('update(finish)', TABLE, error.message);
    }
  }

  async markFailed(runId: ResolutionRunId, reason: string): Promise<void> {
    const { error } = await this.db
      .schema(SCHEMA)
      .from(TABLE)
      .update({
        status:      'failed',
        finished_at: new Date().toISOString(),
        notes:       reason,
      })
      .eq('id', runId);

    if (error) {
      throw new RepositoryError('update(markFailed)', TABLE, error.message);
    }
  }

  async findActive(productKey: string): Promise<ResolutionRunSummary | null> {
    const { data, error } = await this.db
      .schema(SCHEMA)
      .from(TABLE)
      .select('id, product_key, started_at, finished_at, status, activities_processed, candidates_generated, triggered_by')
      .eq('product_key', productKey)
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('select(findActive)', TABLE, error.message);
    }
    if (!data) return null;

    return this.mapRow(data);
  }

  private mapRow(row: Record<string, unknown>): ResolutionRunSummary {
    return {
      runId:               row['id'] as ResolutionRunId,
      productKey:          row['product_key'] as string,
      startedAt:           new Date(row['started_at'] as string),
      finishedAt:          row['finished_at'] ? new Date(row['finished_at'] as string) : null,
      status:              row['status'] as ResolutionRunSummary['status'],
      activitiesProcessed: (row['activities_processed'] as number) ?? 0,
      candidatesGenerated: (row['candidates_generated'] as number) ?? 0,
      // classificationCounts e errorCount não estão na tabela — zeros por omissão
      // serão calculados via candidates na Fase de observabilidade
      classificationCounts: { matched: 0, ambiguous: 0, unresolved: 0, proposed_new: 0 },
      errorCount:           0,
      triggeredBy:          (row['triggered_by'] as string) ?? 'unknown',
    };
  }
}
