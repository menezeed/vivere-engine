import { logger } from '../../lib/logger';
import { BudgetRefusedError, type Billable, type PaidAttemptGate } from '../../lib/budgetGuard';

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

/**
 * Códigos de erro da fase de LIGAÇÃO (Node/undici): o pedido HTTP não chegou
 * a ser enviado ao Google, por isso não pode ter sido cobrado. Qualquer
 * outra falha de fetch (ligação reiniciada, timeout depois de enviar, erro
 * desconhecido) é 'uncertain' e conta como gasto.
 */
const CONNECT_PHASE_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export function billableOfFetchError(err: unknown): Billable {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === 'string' && CONNECT_PHASE_ERROR_CODES.has(code) ? 'no' : 'uncertain';
}

export interface GooglePlacesApiClientOptions {
  /** Injecção para testes (por omissão, o fetch global). */
  fetch?: typeof fetch;
  /** Atraso base entre tentativas (backoff exponencial). */
  baseDelayMs?: number;
}

/** Tentativas enviadas e custo estimado das que contaram como gasto. */
interface CostAccumulator {
  costUsd: number;
  attemptsSent: number;
}

export interface EnrichedDetailsResult {
  details: GooglePlaceEnriched | null;
  /** Estimativa das tentativas que contaram como gasto (incluindo incertas). */
  costUsd: number;
  /** Preenchido quando o orçamento recusou a (primeira ou seguinte) tentativa. */
  budgetRefusedReason?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GooglePlacesApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseDelayMs: number | undefined;

  constructor(
    private readonly apiKey: string,
    options: GooglePlacesApiClientOptions = {},
  ) {
    if (!apiKey) {
      throw new Error('GooglePlacesApiClient requer uma API key válida');
    }
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.baseDelayMs = options.baseDelayMs;
  }

  /**
   * Um pedido pago com tentativas repetidas, cada tentativa coberta por uma
   * reserva própria (gate.begin) ANTES de ser enviada. Recusa →
   * BudgetRefusedError e nenhuma tentativa seguinte. Só falhas de fetch são
   * repetidas (como o withRetry anterior); uma resposta (qualquer status)
   * termina o ciclo.
   *
   * Liquidação de cada tentativa (regra conservadora, ver Billable):
   *   resposta 2xx → 'yes'; resposta não-2xx → 'uncertain' (gasto);
   *   falha de fetch na fase de ligação → 'no' (libertada);
   *   outra falha de fetch → 'uncertain' (gasto).
   * A liquidação acontece logo que há resposta, ANTES de ler o corpo: uma
   * falha a ler o corpo depois de um 200 já conta como gasto.
   */
  private async paidRequest(
    gate: PaidAttemptGate,
    callType: string,
    estimatedCostUsd: number,
    maxAttempts: number,
    defaultDelayMs: number,
    url: string,
    init: RequestInit,
    acc: CostAccumulator,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ticket = await gate.begin(callType, estimatedCostUsd);
      if (!ticket.ok) {
        throw new BudgetRefusedError(ticket.reason, acc.attemptsSent);
      }

      let response: Response;
      try {
        acc.attemptsSent++;
        response = await this.fetchImpl(url, init);
      } catch (err) {
        const billable = billableOfFetchError(err);
        await ticket.settle(billable);
        if (billable !== 'no') acc.costUsd += estimatedCostUsd;
        lastError = err;
        if (attempt < maxAttempts) {
          await sleep((this.baseDelayMs ?? defaultDelayMs) * 2 ** (attempt - 1));
        }
        continue;
      }

      await ticket.settle(response.ok ? 'yes' : 'uncertain');
      acc.costUsd += estimatedCostUsd;
      return response;
    }
    throw lastError;
  }

  /**
   * Busca textual com viés geográfico. Usa SEMPRE o field mask básico —
   * nunca pede campos enriquecidos numa busca em massa.
   *
   * Cada tentativa HTTP passa pelo portão de orçamento (gate); lança
   * BudgetRefusedError se o orçamento recusar.
   */
  async textSearch(
    params: {
      query: string;
      lat: number;
      lng: number;
      radiusMeters: number;
    },
    gate: PaidAttemptGate,
  ): Promise<{ places: GooglePlaceRaw[]; costUsd: number }> {
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
    // Pedido montado ANTES de qualquer reserva: um erro aqui não reserva nada.
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': FIELD_MASK_BASIC,
      },
      body: JSON.stringify(body),
    };

    const acc: CostAccumulator = { costUsd: 0, attemptsSent: 0 };
    const response = await this.paidRequest(
      gate,
      'text_search',
      ESTIMATED_COST_PER_CALL.text_search_basic,
      3,
      1000,
      `${PLACES_API_BASE}/places:searchText`,
      init,
      acc,
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Google Places textSearch falhou (${response.status}): ${text}`);
    }

    const data = (await response.json()) as TextSearchResponse;
    return {
      places: data.places ?? [],
      costUsd: acc.costUsd,
    };
  }

  /**
   * Enriquecimento (telefone, site, horário) — chamado SOMENTE para
   * place_ids já filtrados como relevantes pelo Collector, nunca
   * para todo resultado bruto da busca.
   *
   * Não lança por falha da API (o item segue sem estes campos), mas cada
   * tentativa já foi liquidada no portão de orçamento antes de o erro ser
   * tratado aqui: uma falha depois de enviar continua a contar como gasto.
   */
  async getEnrichedDetails(placeId: string, gate: PaidAttemptGate): Promise<EnrichedDetailsResult> {
    const acc: CostAccumulator = { costUsd: 0, attemptsSent: 0 };
    try {
      const response = await this.paidRequest(
        gate,
        'place_details_enriched',
        ESTIMATED_COST_PER_CALL.place_details_enriched,
        2,
        500,
        `${PLACES_API_BASE}/places/${placeId}`,
        {
          headers: {
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': FIELD_MASK_ENRICHED,
          },
        },
        acc,
      );

      if (!response.ok) {
        logger.warn({ placeId, status: response.status }, 'enriquecimento de place falhou, seguindo sem esses campos');
        return { details: null, costUsd: acc.costUsd };
      }

      const details = (await response.json()) as GooglePlaceEnriched;
      return { details, costUsd: acc.costUsd };
    } catch (err) {
      if (err instanceof BudgetRefusedError) {
        return { details: null, costUsd: acc.costUsd, budgetRefusedReason: err.reason };
      }
      logger.warn(
        { placeId, err, attemptsSent: acc.attemptsSent, costUsd: acc.costUsd },
        'erro ao enriquecer place (custo das tentativas enviadas já contado), seguindo sem esses campos',
      );
      return { details: null, costUsd: acc.costUsd };
    }
  }
}
