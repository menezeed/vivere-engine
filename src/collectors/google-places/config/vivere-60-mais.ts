import type { GooglePlacesProductConfig, GooglePlacesRegion } from './GooglePlacesProductConfig';
import { getRegion, type RegionDefinition } from '../../../config/regions';

/** Regiões do Vivere 60+ no Google Places, pela ordem histórica de execução. */
export const VIVERE_60_MAIS_REGION_KEYS = [
  'cabo_frio',
  'araruama',
  'sp_brooklin_pilot',
  'campo_belo',
  'sao_pedro_da_aldeia',
  'iguaba_grande',
  'moema',
  'santo_amaro',
] as const;

export function toGooglePlacesRegion(region: RegionDefinition): GooglePlacesRegion {
  return {
    key: region.key,
    display_label: region.city_label,
    lat: region.center.lat,
    lng: region.center.lng,
    radius_m: region.radius_m,
  };
}

/**
 * Instância real: Vivere 60+ — Região dos Lagos / RJ.
 *
 * Validada contra dry-run real (ver documento de validação da Fase 1
 * e o relatório comparativo Google Places x Prefeitura de Cabo Frio,
 * conduzidos sob o nome anterior do produto, "Vida Ativa 60+" — os
 * dados e a validação seguem integralmente válidos após a renomeação
 * da plataforma para Vivere; só o product_key mudou).
 *
 * Raio de 12 km em Cabo Frio e Araruama — escolha deliberadamente ampla
 * para a primeira rodada exploratória (ver histórico de decisão:
 * pode incluir distritos mais afastados como Tamoios em Cabo Frio,
 * ou os distritos rurais de Araruama; isso é esperado e aceitável,
 * ajustável em uma linha sem tocar o motor).
 *
 * NOTA SOBRE COORDENADAS: os centróides de Cabo Frio e Araruama (em
 * src/config/regions.ts) são aproximações do centro urbano — vale
 * confirmar visualmente num mapa antes de qualquer ajuste fino.
 */
export const VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG: GooglePlacesProductConfig = {
  product_key: 'vivere-60-mais',
  source_key: 'google_places',
  source_priority: 70, // conforme tabela de Source Priority da plataforma — Google Places abaixo de fontes oficiais

  // Regiões vindas do registo declarativo src/config/regions.ts (centro,
  // raio, rótulo e a justificação de cada escolha estão lá). Esta lista
  // só escolhe QUAIS regiões este produto pesquisa e por que ordem.
  // Regressão: __tests__/vivere-60-mais.regression.test.ts.
  regions: VIVERE_60_MAIS_REGION_KEYS.map((key) => toGooglePlacesRegion(getRegion(key))),

  // As 7 categorias confirmadas para este produto. query_kind distingue
  // buscas de "tipo de lugar" (teatro, museu — esperamos que o resultado
  // SEJA o lugar buscado) de "intenção de atividade" (hidroginástica,
  // dança para idosos — esperamos um lugar que OFERECE aquilo).
  categories: [
    { key: 'teatro', query_text: 'teatro', kind: 'place_type' },
    { key: 'centro_cultural', query_text: 'centro cultural', kind: 'place_type' },
    { key: 'museu', query_text: 'museu', kind: 'place_type' },
    { key: 'parque', query_text: 'parque', kind: 'place_type' },
    { key: 'biblioteca', query_text: 'biblioteca', kind: 'place_type' },
    { key: 'hidroginastica', query_text: 'hidroginástica', kind: 'activity_intent' },
    { key: 'danca_idosos', query_text: 'dança para idosos', kind: 'activity_intent' },
  ],

  monthly_budget_usd: 10.0,
  hard_stop_enabled: true,
  alert_threshold_pct: 0.8,
};


