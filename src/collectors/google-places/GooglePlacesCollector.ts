import { logger } from '../../lib/logger';
import { checkBudgetBeforeCall, type BudgetRepo } from '../../lib/budgetGuard';
import { buildQueriesForProduct, findRegion, type GooglePlacesProductConfig, type PlaceSearchQuery } from './config/GooglePlacesProductConfig';
import { GooglePlacesApiClient, type GooglePlaceRaw, type GooglePlaceEnriched } from './GooglePlacesApiClient';
import type { RawVenueItem, VenueCollectorError, VenueCollectorResult } from '../../types/RawVenueItem';

export interface GooglePlacesCollectorOptions {
  dryRun?: boolean;
  limitQueries?: number; // útil para teste manual ("rode só as 2 primeiras queries")
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

  constructor(
    private readonly apiClient: GooglePlacesApiClient,
    private readonly budgetRepo: BudgetRepo,
    private readonly productConfig: GooglePlacesProductConfig,
  ) {}

  async collect(options: GooglePlacesCollectorOptions = {}): Promise<VenueCollectorResult> {
    const allQueries = buildQueriesForProduct(this.productConfig);
    const queries = options.limitQueries ? allQueries.slice(0, options.limitQueries) : allQueries;

    const errors: VenueCollectorError[] = [];
    const rawByPlaceId = new Map<string, { item: RawVenueItem; alternateHints: string[] }>();
    let queriesExecuted = 0;
    let queriesSkippedBudget = 0;
    let placesFoundRaw = 0;
    let totalCostUsd = 0;

    for (const query of queries) {
      const budgetCheck = await checkBudgetBeforeCall(
        'google_places',
        0.032, // custo estimado de text_search_basic, ver GooglePlacesApiClient.ESTIMATED_COST_PER_CALL
        this.budgetRepo,
      );

      if (!budgetCheck.allowed) {
        logger.warn(
          { query: query.query_text, reason: budgetCheck.reason },
          'query pulada — orçamento da Google Places API esgotado',
        );
        queriesSkippedBudget++;
        continue;
      }

      try {
        const region = findRegion(this.productConfig, query.region_key);
        const { places, costUsd } = await this.apiClient.textSearch({
          query: query.query_text,
          lat: region.lat,
          lng: region.lng,
          radiusMeters: region.radius_m,
        });

        totalCostUsd += costUsd;
        await this.budgetRepo.recordSpend('google_places', 'text_search', costUsd);
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
      const enrichBudgetCheck = await checkBudgetBeforeCall('google_places', 0.017, this.budgetRepo);

      if (!enrichBudgetCheck.allowed) {
        logger.warn(
          { placeId: item.source_item_id, reason: enrichBudgetCheck.reason },
          'enriquecimento pulado — orçamento esgotado, item segue sem telefone/site/horário',
        );
        continue;
      }

      const { details, costUsd } = await this.apiClient.getEnrichedDetails(item.source_item_id);
      totalCostUsd += costUsd;
      if (costUsd > 0) {
        await this.budgetRepo.recordSpend('google_places', 'place_details_enriched', costUsd);
      }

      if (details) {
        this.applyEnrichment(item, details);
      }
    }

    logger.info(
      {
        queriesExecuted,
        queriesSkippedBudget,
        placesFoundRaw,
        placesReturned: dedupedItems.length,
        estimatedCostUsd: Math.round(totalCostUsd * 100) / 100,
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
        estimated_cost_usd: Math.round(totalCostUsd * 100) / 100,
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
