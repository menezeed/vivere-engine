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
import { applyGeographicGate } from '../../pipeline/stages/01-geographic-gate';
import type { RawVenueItem } from '../../types/RawVenueItem';
import type { PersistedRawVenueItem } from '../types/persistenceTypes';

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
 *
 * REPROCESSAMENTO (reprocessVenuesFromRaw): IngestionRun representa
 * uma EXECUÇÃO AUDITÁVEL DO PIPELINE, não necessariamente uma coleta
 * de dados nova — reprocessar itens já persistidos em
 * raw_venue_items também abre/fecha um IngestionRun, pela mesma
 * razão que uma coleta ao vivo abre: "quando isto rodou, com que
 * regras, e qual foi o resultado" é uma pergunta de auditoria válida
 * em ambos os casos. runVenueIngestion e reprocessVenuesFromRaw
 * partilham a mesma lógica de filtro/gate/staging/métricas via
 * stageVenues() privado — a ÚNICA diferença entre os dois caminhos é
 * a origem de items/persistedRaw (Collector vs. leitura da Camada A).
 */
export class IngestionOrchestrator {
  constructor(private readonly repos: IRepositorySet) {}

  /**
   * Sequência partilhada: filtro (00-filter-venue) → Regional
   * Geographic Gate (01-geographic-gate, ADR-0022) → contagens →
   * persistência em venues_staging. Usado por runVenueIngestion e
   * reprocessVenuesFromRaw — nunca duplicado entre os dois.
   */
  private async stageVenues<TRuleId extends string, TAmbiguityLabel extends string>(
    items: RawVenueItem[],
    persistedRaw: PersistedRawVenueItem[],
    sourceConfig: SourceConfigContract,
    venueFilterRuleSet: VenueFilterRuleSet<TRuleId, TAmbiguityLabel>,
    dryRun: boolean,
  ): Promise<{ stagedItems: number; rejectedItems: number; geoExcludedItems: number }> {
    const { source_key: sourceKey, product_key } = sourceConfig;

    const filtered = filterVenueItems(items, venueFilterRuleSet);

    // ADR-0022 (Regional Geographic Gate) — só aplica quando a fonte
    // declara regions (aditivo em SourceConfigContract). Fontes sem
    // regions (ex: WordPress) seguem sem alteração de comportamento:
    // 'filtered' já satisfaz estruturalmente o tipo esperado por
    // insertBatch (geographic é opcional).
    const geoGated: readonly (FilteredVenueItem<TRuleId, TAmbiguityLabel> & { geographic?: import('../../pipeline/stages/01-geographic-gate/types').GeographicMetadata })[] = sourceConfig.regions
      ? applyGeographicGate(filtered, sourceConfig.regions)
      : filtered;

    const geoExcludedCount = geoGated.filter((f) => f.geographic?.bucket === 'outside_region').length;

    if (geoExcludedCount > 0) {
      logger.info(
        {
          sourceKey,
          productKey: product_key,
          geoExcludedCount,
          excluded: geoGated
            .filter((f) => f.geographic?.bucket === 'outside_region')
            .map((f) => ({ name: f.item.name, distanceMeters: Math.round(f.geographic!.distanceMeters) })),
        },
        'itens classificados outside_region pelo Regional Geographic Gate (ADR-0022) — persistidos em venues_staging com geographic_status próprio, proposal_status inalterado; fora da fila normal de Human Review e não elegíveis para publicação nesta região',
      );
    }

    const rejectedCount = geoGated.filter((f) => f.filter.decision === 'rejected').length;

    const stagedCount = dryRun
      ? 0
      : await this.repos.venueStaging.insertBatch(
          [...geoGated] as FilteredVenueItem<string, string>[],
          persistedRaw,
          product_key,
        );

    return { stagedItems: stagedCount, rejectedItems: rejectedCount, geoExcludedItems: geoExcludedCount };
  }

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

      const staged = await this.stageVenues(collected.items, persistedRaw, sourceConfig, venueFilterRuleSet, dryRun);

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
        ...staged,
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

  /**
   * Reprocessa venues já persistidos em raw_venue_items (Camada A),
   * sem nenhuma chamada à fonte externa — zero custo. Usa a MESMA
   * sequência de filtro/gate/staging que runVenueIngestion
   * (stageVenues privado) — a única diferença é a origem dos dados:
   * leitura de raw_venue_items em vez de collector.collect().
   *
   * Útil para: validar uma nova versão das regras de filtro contra
   * dados já coletados; recuperar de uma falha na etapa de staging
   * sem repetir a coleta (ex: bug que impediu a ingestão original de
   * completar depois de já ter pago pela coleta); comparar o
   * resultado do pipeline antes/depois de uma mudança, mantendo os
   * dados de entrada idênticos.
   *
   * Abre/fecha um IngestionRun como qualquer outra execução do
   * pipeline — IngestionRun audita "quando isto rodou e qual foi o
   * resultado", não "quando uma coleta aconteceu".
   */
  async reprocessVenuesFromRaw<TRuleId extends string, TAmbiguityLabel extends string>(
    sourceConfig: SourceConfigContract,
    venueFilterRuleSet: VenueFilterRuleSet<TRuleId, TAmbiguityLabel>,
    regionLabel: string,
    options: { dryRun?: boolean } = {},
  ): Promise<IngestionSummary> {
    const dryRun = options.dryRun ?? false;
    const { source_key: sourceKey, product_key } = sourceConfig;

    logger.info({ sourceKey, productKey: product_key, regionLabel, dryRun }, 'iniciando reprocessamento de venues a partir de raw_venue_items');

    let runId: string | null = null;

    try {
      if (!dryRun) {
        runId = await this.repos.ingestionRun.start(sourceKey);
      }

      if (!this.repos.rawVenueItem.findByRegionLabel) {
        throw new Error(
          'Este IRawVenueItemRepository não implementa findByRegionLabel — reprocessamento indisponível',
        );
      }

      const rows = await this.repos.rawVenueItem.findByRegionLabel(sourceKey, regionLabel);
      const items = rows.map((r) => r.item);
      const persistedRaw = rows.map((r) => r.persisted);

      const staged = await this.stageVenues(items, persistedRaw, sourceConfig, venueFilterRuleSet, dryRun);

      if (!dryRun && runId) {
        await this.repos.ingestionRun.finish(runId, {
          itemsCollected: items.length,
          itemsErrored: 0, // leitura de dados já validados — não há "erro de coleta" neste caminho
        });
      }

      const summary: IngestionSummary = {
        ingestionRunId: runId,
        dryRun,
        rawItemsCollected: items.length,
        rawItemsPersisted: persistedRaw.length, // itens lidos, já persistidos antes desta execução
        rawItemsErrored: 0,
        ...staged,
      };

      logger.info(summary, 'reprocessamento de venues concluído');
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!dryRun && runId) {
        await this.repos.ingestionRun.markFailed(runId, message);
      }
      logger.error({ sourceKey, runId, regionLabel, error: message }, 'reprocessamento de venues falhou');
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
        geoExcludedItems: 0, // activities não têm o Regional Geographic Gate (ADR-0022) — só venues têm lat/lng
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
