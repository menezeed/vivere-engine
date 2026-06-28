import { logger } from '../../lib/logger';
import { withRetry } from '../../lib/retry';

const PLACES_API_BASE = 'https://places.googleapis.com/v1';

/**
 * Field mask "Essentials" — usado em TODA busca inicial.
 * Deliberadamente não inclui telefone, site, horário ou fotos:
 * esses são campos de cobrança mais cara e só são pedidos depois,
 * para os resultados que sobreviverem ao filtro de relevância.
 */
const FIELD_MASK_BASIC = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.businessStatus',
].join(',');

// IMPORTANTE: Place Details (New) retorna o objeto Place diretamente,
// sem envelope `places[]` — diferente de Text Search e Nearby Search.
// Por isso o field mask aqui NÃO leva o prefixo "places." (esse prefixo
// é o que causava o HTTP 400: os caminhos solicitados não existiam na
// resposta de Place Details, o que a API trata como "nenhum campo válido").
// Ver: https://developers.google.com/maps/documentation/places/web-service/place-details
const FIELD_MASK_ENRICHED = [
  'id',
  'nationalPhoneNumber',
  'websiteUri',
  'regularOpeningHours',
].join(',');

// Estimativas de custo por chamada, em USD. Confirmar valores atuais
// na calculadora oficial do Google antes de rodar em escala — preços
// mudam e variam por volume mensal acumulado da conta.
export const ESTIMATED_COST_PER_CALL = {
  text_search_basic: 0.032,
  place_details_enriched: 0.017,
};

export interface GooglePlaceRaw {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  businessStatus?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';
}

export interface GooglePlaceEnriched {
  id: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions: string[] };
}

interface TextSearchResponse {
  places?: GooglePlaceRaw[];
}

export class GooglePlacesApiClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error('GooglePlacesApiClient requer uma API key válida');
    }
  }

  /**
   * Busca textual com viés geográfico. Usa SEMPRE o field mask básico —
   * nunca pede campos enriquecidos numa busca em massa.
   */
  async textSearch(params: {
    query: string;
    lat: number;
    lng: number;
    radiusMeters: number;
  }): Promise<{ places: GooglePlaceRaw[]; costUsd: number }> {
    const body = {
      textQuery: params.query,
      locationBias: {
        circle: {
          center: { latitude: params.lat, longitude: params.lng },
          radius: params.radiusMeters,
        },
      },
      languageCode: 'pt-BR',
    };

    const response = await withRetry(
      () =>
        fetch(`${PLACES_API_BASE}/places:searchText`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': FIELD_MASK_BASIC,
          },
          body: JSON.stringify(body),
        }),
      { maxAttempts: 3, baseDelayMs: 1000 },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Places textSearch falhou (${response.status}): ${text}`);
    }

    const data = (await response.json()) as TextSearchResponse;
    return {
      places: data.places ?? [],
      costUsd: ESTIMATED_COST_PER_CALL.text_search_basic,
    };
  }

  /**
   * Enriquecimento (telefone, site, horário) — chamado SOMENTE para
   * place_ids já filtrados como relevantes pelo Collector, nunca
   * para todo resultado bruto da busca.
   */
  async getEnrichedDetails(placeId: string): Promise<{ details: GooglePlaceEnriched | null; costUsd: number }> {
    try {
      const response = await withRetry(
        () =>
          fetch(`${PLACES_API_BASE}/places/${placeId}`, {
            headers: {
              'X-Goog-Api-Key': this.apiKey,
              'X-Goog-FieldMask': FIELD_MASK_ENRICHED,
            },
          }),
        { maxAttempts: 2, baseDelayMs: 500 },
      );

      if (!response.ok) {
        logger.warn({ placeId, status: response.status }, 'enriquecimento de place falhou, seguindo sem esses campos');
        return { details: null, costUsd: 0 };
      }

      const details = (await response.json()) as GooglePlaceEnriched;
      return { details, costUsd: ESTIMATED_COST_PER_CALL.place_details_enriched };
    } catch (err) {
      logger.warn({ placeId, err }, 'erro ao enriquecer place, seguindo sem esses campos');
      return { details: null, costUsd: 0 };
    }
  }
}
