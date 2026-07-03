import type { SupabaseClient } from '@supabase/supabase-js';
import type { IIngestionRunReadRepository } from '../../persistence/types/repositoryInterfaces';

export class IngestionRunReadRepository implements IIngestionRunReadRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(limit = 20) {
    const { data, error } = await this.db
      .schema('staging')
      .from('ingestion_runs')
      .select('id, source_key, status, items_collected, items_errored, started_at, finished_at')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`IngestionRunReadRepository.list: ${error.message}`);
    return data ?? [];
  }
}
