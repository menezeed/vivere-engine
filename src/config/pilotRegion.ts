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

export interface RegionCenter {
  lat: number;
  lng: number;
  radius_m: number;
}

export const PILOT_REGIONS: Record<string, RegionCenter> = {
  cabo_frio: { lat: -22.8894, lng: -42.0188, radius_m: 12000 },
  araruama: { lat: -22.8717, lng: -42.3433, radius_m: 12000 },
};

export interface PlaceSearchQuery {
  region_key: keyof typeof PILOT_REGIONS;
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

export function buildPilotQueries(): PlaceSearchQuery[] {
  const queries: PlaceSearchQuery[] = [];

  for (const regionKey of Object.keys(PILOT_REGIONS) as Array<keyof typeof PILOT_REGIONS>) {
    const cityLabel = regionKey === 'cabo_frio' ? 'Cabo Frio RJ' : 'Araruama RJ';

    for (const cat of CATEGORIES) {
      queries.push({
        region_key: regionKey,
        category_key: cat.key,
        query_text: `${cat.text} em ${cityLabel}`,
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
