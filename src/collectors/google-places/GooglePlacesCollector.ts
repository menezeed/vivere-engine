import { logger } from '../../lib/logger';
import { BudgetGuard, BudgetRefusedError, toBudgetGuard, type BudgetRepo, type PaidAttemptGate } from '../../lib/budgetGuard';
import { buildQueriesForProduct, findRegion, type GooglePlacesProductConfig, type PlaceSearchQuery } from './config/GooglePlacesProductConfig';
import { GooglePlacesApiClient, type GooglePlaceRaw, type GooglePlaceEnriched } from './GooglePlacesApiClient';
import type { RawVenueItem, VenueCollectorError, VenueCollectorResult } from '../../types/RawVenueItem';

export interface GooglePlacesCollectorOptions {
  dryRun?: boolean;
  limitQueries?: number; // útil para teste manual ("rode só as 2 primeiras queries")
  /** staging.ingestion_runs.id desta execução (ligação de auditoria do orçamento). */
  ingestionRunId?: string | null;
}

/**
 * Collector genérico do Google Places — não conhece nenhuma região
 * ou categoria específica de produto. Recebe a configuração completa
 * (regiões, categorias, orçamento) via construtor, igual ao padrão já
 * estabelecido no WordPressContentCollector. Cada produto da
 * plataforma Vivere injeta seu próprio GooglePlacesProductConfig.
 */
export class GooglePlacesCollector {
  readonly sourceKey = 'google_places';
  /** Guarda de orçamento (alertas por processo e resumo de custo da execução). */
  readonly budgetGuard: BudgetGuard;

  constructor(
    private readonly apiClient: GooglePlacesApiClient,
    budget: BudgetRepo | BudgetGuard,
    private readonly productConfig: GooglePlacesProductConfig,
  ) {
    this.budgetGuard = toBudgetGuard(budget);
    this.gate = this.budgetGuard.attemptGate(this.sourceKey);
  }

  /**
   * Custo reportado (stats.estimated_cost_usd) medido no PORTÃO, por
   * tentativa HTTP liquidada como gasto ('yes' ou 'uncertain'), a mesma regra
   * do orçamento persistente (L5). Antes somava só o costUsd devolvido por
   * pedidos bem-sucedidos: tentativas enviadas num pedido que acabava em
   * excepção (falha após repetições, ou recusa de orçamento a meio) ficavam
   * fora do total, embora cobradas pela Google (BAIXO da revisão r1 do L5).
   * O medidor é LOCAL a cada execução (revisão r0 do #31, MÉDIO) e cada
   * ticket só conta uma vez, mesmo que settle() seja repetido (BAIXO).
   */
  private static meteredGate(inner: PaidAttemptGate, meter: { spentUsd: number }): PaidAttemptGate {
    return {
      begin: async (callType, estimatedCostUsd) => {
        const ticket = await inner.begin(callType, estimatedCostUsd);
        if (!ticket.ok) return ticket;
        let counted = false;
        return {
          ...ticket,
          settle: async (billable) => {
            await ticket.settle(billable);
            if (!counted && billable !== 'no') {
              counted = true;
              meter.spentUsd += estimatedCostUsd;
            }
          },
        };
      },
    };
  }

  /** Recusa execuções concorrentes na mesma instância (partilham o run do BudgetGuard). */
  private collecting = false;

  /** Portão de orçamento por tentativa HTTP (fornecedor google_places). */
  private readonly gate: PaidAttemptGate;

  async collect(options: GooglePlacesCollectorOptions = {}): Promise<VenueCollectorResult> {
    if (this.collecting) {
      throw new Error('GooglePlacesCollector.collect() já em curso nesta instância — execuções concorrentes partilhariam o run de orçamento');
    }
    this.collecting = true;
    try {
      const meter = { spentUsd: 0 };
      return await this.collectOnce(options, GooglePlacesCollector.meteredGate(this.gate, meter), meter);
    } finally {
      this.collecting = false;
    }
  }

  private async collectOnce(
    options: GooglePlacesCollectorOptions,
    gate: PaidAttemptGate,
    meter: { spentUsd: number },
  ): Promise<VenueCollectorResult> {
    const allQueries = buildQueriesForProduct(this.productConfig);
    const queries = options.limitQueries ? allQueries.slice(0, options.limitQueries) : allQueries;

    const errors: VenueCollectorError[] = [];
    const rawByPlaceId = new Map<string, { item: RawVenueItem; alternateHints: string[] }>();
    let queriesExecuted = 0;
    let queriesSkippedBudget = 0;
    let placesFoundRaw = 0;

    // Uma execução de orçamento por collect(): novo run_key (tecto por execução).
    this.budgetGuard.startRun(options.ingestionRunId ?? null);

    for (const query of queries) {
      try {
        const region = findRegion(this.productConfig, query.region_key);
        // Cada tentativa HTTP do cliente reserva antes de enviar (gate);
        // recusa → BudgetRefusedError e nenhuma tentativa (seguinte) é enviada.
        let places: GooglePlaceRaw[];
        try {
          const r = await this.apiClient.textSearch(
            {
              query: query.query_text,
              lat: region.lat,
              lng: region.lng,
              radiusMeters: region.radius_m,
            },
            gate,
          );
          places = r.places;
        } catch (err) {
          if (!(err instanceof BudgetRefusedError)) throw err;
          logger.warn(
            { query: query.query_text, reason: err.reason, attemptsSent: err.attemptsSent },
            'query pulada — orçamento da Google Places API esgotado',
          );
          queriesSkippedBudget++;
          continue;
        }
        queriesExecuted++;
        placesFoundRaw += places.length;

        logger.info(
          { query: query.query_text, region: query.region_key, resultCount: places.length },
          'busca Google Places concluída',
        );

        for (const place of places) {
          const mapped = this.mapToCanonical(place, query);
          if (!mapped) {
            errors.push({
              source_item_id: place.id ?? null,
              message: 'lugar descartado: business_status indica fechamento permanente, ou campos essenciais ausentes',
              raw_context: place,
            });
            continue;
          }

          const existing = rawByPlaceId.get(mapped.source_item_id);
          if (existing) {
            // Mesmo place_id encontrado por categoria/query diferente —
            // dedupe dentro da execução: mantém o item, acumula os hints
            existing.alternateHints.push(query.category_key);
          } else {
            rawByPlaceId.set(mapped.source_item_id, { item: mapped, alternateHints: [] });
          }
        }
      } catch (err) {
        logger.error({ query: query.query_text, err }, 'falha ao executar busca Google Places');
        errors.push({
          source_item_id: null,
          message: `falha na query "${query.query_text}": ${String(err)}`,
          raw_context: { query },
        });
      }
    }

    // Aplica os hints alternativos acumulados ao raw_payload de cada item,
    // para auditoria de quais categorias trouxeram o mesmo lugar
    const dedupedItems: RawVenueItem[] = [...rawByPlaceId.values()].map(({ item, alternateHints }) => {
      if (alternateHints.length > 0) {
        item.raw_payload._alternate_category_hints = alternateHints;
      }
      return item;
    });

    // Enriquecimento — só para os itens que sobreviveram ao dedupe e ao
    // filtro de relevância básico (aqui: todos os que chegaram até aqui
    // já passaram pelo filtro de closed_permanently em mapToCanonical).
    // O enriquecimento roda mesmo em modo dry-run, porque o objetivo do
    // dry-run é mostrar o resultado completo no log — só a escrita final
    // em staging.venues_staging é suprimida (ver scripts/dry-run, não
    // este Collector).
    for (const item of dedupedItems) {
      // As tentativas são liquidadas no portão (gate) pelo próprio cliente;
      // uma falha depois de enviar continua a contar como gasto.
      const enriched = await this.apiClient.getEnrichedDetails(item.source_item_id, gate);

      if (enriched.budgetRefusedReason) {
        logger.warn(
          { placeId: item.source_item_id, reason: enriched.budgetRefusedReason },
          'enriquecimento pulado — orçamento esgotado, item segue sem telefone/site/horário',
        );
        continue;
      }

      if (enriched.details) {
        this.applyEnrichment(item, enriched.details);
      }
    }

    logger.info(
      {
        queriesExecuted,
        queriesSkippedBudget,
        placesFoundRaw,
        placesReturned: dedupedItems.length,
        estimatedCostUsd: Math.round(meter.spentUsd * 100) / 100,
        apiCost: this.budgetGuard.costSummary().totals,
      },
      'coleta Google Places finalizada',
    );

    return {
      items: dedupedItems,
      errors,
      stats: {
        queries_executed: queriesExecuted,
        queries_skipped_budget: queriesSkippedBudget,
        places_found_raw: placesFoundRaw,
        places_returned: dedupedItems.length,
        estimated_cost_usd: Math.round(meter.spentUsd * 100) / 100,
      },
    };
  }

  private mapToCanonical(place: GooglePlaceRaw, query: PlaceSearchQuery): RawVenueItem | null {
    if (place.businessStatus === 'CLOSED_PERMANENTLY') {
      return null;
    }
    if (!place.id || !place.displayName?.text || !place.location) {
      return null; // campos essenciais ausentes — não há o que mapear com confiança
    }

    return {
      source_key: this.sourceKey,
      source_item_id: place.id,
      collected_at: new Date().toISOString(),

      name: place.displayName.text.trim(),
      address: place.formattedAddress?.trim() ?? null,
      lat: place.location.latitude,
      lng: place.location.longitude,

      phone: null, // preenchido depois, em applyEnrichment, se o orçamento permitir
      website: null,
      opening_hours_raw: null,
      image_url: null,

      source_category_hint: query.category_key,
      source_query_text:    query.query_text,
      source_query_kind:    query.query_kind,
      source_region_label:  query.region_label,

      google_types: place.types ?? [],
      google_business_status: place.businessStatus ?? 'OPERATIONAL',

      raw_payload: { ...place },
    };
  }

  private applyEnrichment(item: RawVenueItem, details: GooglePlaceEnriched): void {
    item.phone = details.nationalPhoneNumber ?? null;
    item.website = details.websiteUri ?? null;
    item.opening_hours_raw = details.regularOpeningHours?.weekdayDescriptions ?? null;
    item.raw_payload._enriched = details as unknown as Record<string, unknown>;
  }
}
