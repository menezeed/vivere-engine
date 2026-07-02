import { logger } from '../../lib/logger';
import type { IngestionSummary } from '../types/persistenceTypes';
import type { IRepositorySet } from '../types/repositoryInterfaces';
import type {
  VenueCollectorContract,
  ActivityCollectorContract,
  SourceConfigContract,
} from '../types/collectorContracts';
import type { VenueFilterRuleSet } from '../../pipeline/stages/00-filter-venue/types';
import { filterVenueItems } from '../../pipeline/stages/00-filter-venue';
import type { FilteredVenueItem } from '../../pipeline/stages/00-filter-venue/index';

/**
 * Coordena o fluxo completo de ingestão: coleta → Camada A → filtro
 * → Camada B. Depende apenas de interfaces (IRepositorySet,
 * VenueCollectorContract, ActivityCollectorContract, SourceConfigContract)
 * — nunca de classes concretas como GooglePlacesCollector ou
 * WordPressContentCollector.
 *
 * Isso permite que a RepositoryFactory forneça implementações
 * alternativas (mocks em testes, Supabase em produção, SQLite em
 * integração local) sem alterar uma linha deste arquivo.
 *
 * DRY-RUN: quando dryRun=true, coleta e filtra normalmente mas não
 * chama nenhum repositório. Útil para validação sem banco configurado.
 *
 * TRANSAÇÕES: não usa uma transação englobando toda a coleta.
 * A idempotência por ON CONFLICT DO NOTHING em cada tabela é a
 * garantia de segurança em reexecuções — mais robusta que uma
 * transação longa sujeita a timeout.
 */
export class IngestionOrchestrator {
  constructor(private readonly repos: IRepositorySet) {}

  async runVenueIngestion<TRuleId extends string, TAmbiguityLabel extends string>(
    collector: VenueCollectorContract,
    sourceConfig: SourceConfigContract,
    venueFilterRuleSet: VenueFilterRuleSet<TRuleId, TAmbiguityLabel>,
    options: { dryRun?: boolean; limitQueries?: number } = {},
  ): Promise<IngestionSummary> {
    const dryRun = options.dryRun ?? false;
    const { source_key: sourceKey, product_key } = sourceConfig;

    logger.info({ sourceKey, productKey: product_key, dryRun }, 'iniciando ingestão de venues');

    let runId: string | null = null;

    try {
      if (!dryRun) {
        runId = await this.repos.ingestionRun.start(sourceKey);
      }

      const collected = await collector.collect({ limitQueries: options.limitQueries });

      const persistedRaw = dryRun
        ? []
        : await this.repos.rawVenueItem.insertBatch(collected.items, runId!);

      const filtered = filterVenueItems(collected.items, venueFilterRuleSet);
      const rejectedCount = filtered.filter((f) => f.filter.decision === 'rejected').length;

      const stagedCount = dryRun
        ? 0
        : await this.repos.venueStaging.insertBatch(
            filtered as FilteredVenueItem<string, string>[],
            persistedRaw,
            product_key,
          );

      if (!dryRun && runId) {
        await this.repos.ingestionRun.finish(runId, {
          itemsCollected: collected.items.length,
          itemsErrored: collected.errors.length,
        });
      }

      const summary: IngestionSummary = {
        ingestionRunId: runId,
        dryRun,
        rawItemsCollected: collected.items.length,
        rawItemsPersisted: persistedRaw.length,
        rawItemsErrored: collected.errors.length,
        stagedItems: stagedCount,
        rejectedItems: rejectedCount,
      };

      logger.info(summary, 'ingestão de venues concluída');
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!dryRun && runId) {
        await this.repos.ingestionRun.markFailed(runId, message);
      }
      logger.error({ sourceKey, runId, error: message }, 'ingestão de venues falhou');
      throw err;
    }
  }

  async runActivityIngestion(
    collector: ActivityCollectorContract,
    sourceConfig: SourceConfigContract,
    options: { dryRun?: boolean; sinceDays?: number } = {},
  ): Promise<IngestionSummary> {
    const dryRun = options.dryRun ?? false;
    const { source_key: sourceKey, product_key } = sourceConfig;

    logger.info({ sourceKey, productKey: product_key, dryRun }, 'iniciando ingestão de atividades');

    let runId: string | null = null;

    try {
      if (!dryRun) {
        runId = await this.repos.ingestionRun.start(sourceKey);
      }

      const collected = await collector.collect({ sinceDays: options.sinceDays });

      const persistedRaw = dryRun
        ? []
        : await this.repos.rawActivityItem.insertBatch(collected.items, runId!);

      const stagedCount = dryRun
        ? 0
        : await this.repos.activityStaging.insertBatch(collected.items, persistedRaw, product_key);

      if (!dryRun && runId) {
        await this.repos.ingestionRun.finish(runId, {
          itemsCollected: collected.items.length,
          itemsErrored: collected.errors.length,
        });
      }

      const summary: IngestionSummary = {
        ingestionRunId: runId,
        dryRun,
        rawItemsCollected: collected.items.length,
        rawItemsPersisted: persistedRaw.length,
        rawItemsErrored: collected.errors.length,
        stagedItems: stagedCount,
        rejectedItems: 0,
      };

      logger.info(summary, 'ingestão de atividades concluída');
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!dryRun && runId) {
        await this.repos.ingestionRun.markFailed(runId, message);
      }
      logger.error({ sourceKey, runId, error: message }, 'ingestão de atividades falhou');
      throw err;
    }
  }
}
