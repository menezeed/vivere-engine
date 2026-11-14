/**
 * Configuração do piloto Google Places — Região dos Lagos / RJ.
 *
 * Valores confirmados explicitamente antes da implementação:
 * - 7 categorias x 2 cidades = 14 queries
 * - Raio: 12 km em ambas as cidades (escolha deliberadamente ampla
 *   para a primeira rodada exploratória — pode incluir distritos
 *   mais afastados como Tamoios em Cabo Frio, ou os distritos rurais
 *   de Araruama; isso é esperado e aceitável nesta fase, e ajustável
 *   em uma linha depois de revisar o dry-run)
 * - Orçamento mensal: USD 10,00, com hard_stop habilitado
 *
 * NOTA SOBRE COORDENADAS: os centróides abaixo são aproximações do
 * centro urbano de cada cidade. Vale confirmar visualmente num mapa
 * antes da primeira execução real — um ajuste de 1-2km no centróide
 * é mais bem feito olhando o mapa do que recalculado aqui.
 */

import { getRegion, type RegionDefinition } from './regions';

export interface RegionCenter {
  lat: number;
  lng: number;
  radius_m: number;
}

/**
 * L3 — as regiões do piloto deixaram de estar codificadas aqui: vêm do
 * registo declarativo src/config/regions.ts. Esta lista só escolhe
 * QUAIS entradas do registo fazem parte do piloto (e por que ordem).
 * Acrescentar uma cidade ao registo não muda o piloto.
 */
export const PILOT_REGION_KEYS = ['cabo_frio', 'araruama'] as const;

function toRegionCenter(region: RegionDefinition): RegionCenter {
  return { lat: region.center.lat, lng: region.center.lng, radius_m: region.radius_m };
}

export const PILOT_REGIONS: Record<string, RegionCenter> = Object.fromEntries(
  PILOT_REGION_KEYS.map((key) => [key, toRegionCenter(getRegion(key))]),
);

export interface PlaceSearchQuery {
  region_key: string;
  category_key: string;
  query_text: string;
  query_kind: 'place_type' | 'activity_intent';
}

/**
 * As 7 categorias da lista confirmada, x 2 cidades = 14 queries.
 * query_kind distingue buscas de "tipo de lugar" (teatro, museu, etc,
 * onde esperamos que o resultado SEJA o lugar buscado) de buscas de
 * "intenção de atividade" (dança para idosos, hidroginástica, onde
 * esperamos que o resultado seja um lugar que OFERECE aquilo —
 * academia, estúdio, clube — não um lugar chamado literalmente assim).
 * Essa distinção não muda o shape de RawVenueItem, só ajuda a
 * interpretar o resultado do dry-run com o critério certo.
 */
const CATEGORIES: Array<{ key: string; text: string; kind: 'place_type' | 'activity_intent' }> = [
  { key: 'teatro', text: 'teatro', kind: 'place_type' },
  { key: 'centro_cultural', text: 'centro cultural', kind: 'place_type' },
  { key: 'museu', text: 'museu', kind: 'place_type' },
  { key: 'parque', text: 'parque', kind: 'place_type' },
  { key: 'biblioteca', text: 'biblioteca', kind: 'place_type' },
  { key: 'hidroginastica', text: 'hidroginástica', kind: 'activity_intent' },
  { key: 'danca_idosos', text: 'dança para idosos', kind: 'activity_intent' },
];

/**
 * Produto cartesiano regiões x categorias. Por omissão usa as regiões
 * do piloto (PILOT_REGION_KEYS); aceita qualquer lista de regiões do
 * registo, sem ramificar pelo nome da cidade.
 */
export function buildPilotQueries(
  regions: readonly RegionDefinition[] = PILOT_REGION_KEYS.map((key) => getRegion(key)),
): PlaceSearchQuery[] {
  const queries: PlaceSearchQuery[] = [];

  for (const region of regions) {
    for (const cat of CATEGORIES) {
      queries.push({
        region_key: region.key,
        category_key: cat.key,
        query_text: `${cat.text} em ${region.city_label}`,
        query_kind: cat.kind,
      });
    }
  }

  return queries;
}

export const BUDGET_CONFIG = {
  provider: 'google_places' as const,
  monthly_budget_usd: 10.0,
  hard_stop_enabled: true,
  alert_threshold_pct: 0.8,
};
