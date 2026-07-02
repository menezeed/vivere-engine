import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger';

export interface IngestionRunStats {
  itemsCollected: number;
  itemsErrored: number;
}

/**
 * Gerencia o ciclo de vida de staging.ingestion_runs.
 *
 * Uma IngestionRun nasce em 'running', fecha em 'success' ou 'failed',
 * e nunca mais muda depois disso. Nenhum UPDATE além de finish/markFailed.
 */
export class IngestionRunRepository {
  constructor(private readonly db: SupabaseClient) {}

  /**
   * Abre uma nova IngestionRun para a source informada.
   * Lança se source_key não existir em public.sources (FK violation).
   */
  async start(sourceKey: string): Promise<string> {
    const { data, error } = await this.db
      .schema('staging')
      .from('ingestion_runs')
      .insert({ source_key: sourceKey, status: 'running' })
      .select('id')
      .single();

    if (error) {
      logger.error({ sourceKey, error: error.message }, 'falha ao abrir IngestionRun');
      throw new Error(`IngestionRunRepository.start: ${error.message}`);
    }

    logger.info({ runId: data.id, sourceKey }, 'IngestionRun aberta');
    return data.id as string;
  }

  /**
   * Fecha a run com 'success' e registra as contagens finais.
   * Idempotente: chamar duas vezes com o mesmo runId não causa erro,
   * mas o segundo UPDATE não altera nada relevante.
   */
  async finish(runId: string, stats: IngestionRunStats): Promise<void> {
    const { error } = await this.db
      .schema('staging')
      .from('ingestion_runs')
      .update({
        status: 'success',
        finished_at: new Date().toISOString(),
        items_collected: stats.itemsCollected,
        items_errored: stats.itemsErrored,
      })
      .eq('id', runId);

    if (error) {
      logger.error({ runId, error: error.message }, 'falha ao fechar IngestionRun');
      throw new Error(`IngestionRunRepository.finish: ${error.message}`);
    }

    logger.info({ runId, ...stats }, 'IngestionRun finalizada com sucesso');
  }

  /**
   * Fecha a run com 'failed'. Chamado no catch do Orchestrator —
   * deve ser robusto: se este UPDATE também falhar, loga mas não
   * relança (o erro original já está sendo propagado).
   */
  async markFailed(runId: string, reason: string): Promise<void> {
    const { error } = await this.db
      .schema('staging')
      .from('ingestion_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);

    if (error) {
      // Loga mas não relança — o erro original do Orchestrator tem precedência
      logger.error({ runId, reason, updateError: error.message }, 'falha ao marcar IngestionRun como failed');
      return;
    }

    logger.warn({ runId, reason }, 'IngestionRun marcada como failed');
  }
}
