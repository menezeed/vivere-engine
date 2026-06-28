import type { GooglePlacesProductConfig } from './GooglePlacesProductConfig';

/**
 * Instância real: Vivere 60+ — Região dos Lagos / RJ.
 *
 * Validada contra dry-run real (ver documento de validação da Fase 1
 * e o relatório comparativo Google Places x Prefeitura de Cabo Frio,
 * conduzidos sob o nome anterior do produto, "Vida Ativa 60+" — os
 * dados e a validação seguem integralmente válidos após a renomeação
 * da plataforma para Vivere; só o product_key mudou).
 *
 * Raio de 12 km em ambas as cidades — escolha deliberadamente ampla
 * para a primeira rodada exploratória (ver histórico de decisão:
 * pode incluir distritos mais afastados como Tamoios em Cabo Frio,
 * ou os distritos rurais de Araruama; isso é esperado e aceitável,
 * ajustável em uma linha sem tocar o motor).
 *
 * NOTA SOBRE COORDENADAS: os centróides abaixo são aproximações do
 * centro urbano de cada cidade — vale confirmar visualmente num mapa
 * antes de qualquer ajuste fino.
 */
export const VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG: GooglePlacesProductConfig = {
  product_key: 'vivere-60-mais',
  source_priority: 70, // conforme tabela de Source Priority da plataforma — Google Places abaixo de fontes oficiais

  regions: [
    { key: 'cabo_frio', display_label: 'Cabo Frio RJ', lat: -22.8894, lng: -42.0188, radius_m: 12000 },
    { key: 'araruama', display_label: 'Araruama RJ', lat: -22.8717, lng: -42.3433, radius_m: 12000 },
  ],

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
