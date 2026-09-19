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
 * Raio de 12 km em Cabo Frio e Araruama — escolha deliberadamente ampla
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
  source_key: 'google_places',
  source_priority: 70, // conforme tabela de Source Priority da plataforma — Google Places abaixo de fontes oficiais

  regions: [
    { key: 'cabo_frio', display_label: 'Cabo Frio RJ', lat: -22.8894, lng: -42.0188, radius_m: 12000 },
    { key: 'araruama', display_label: 'Araruama RJ', lat: -22.8717, lng: -42.3433, radius_m: 12000 },
    // Regional Baseline da Fase 9 (ADR-0021) — piloto de expansão regional.
    // Centro técnico: Av. Padre Antônio José dos Santos, Brooklin, São Paulo.
    // Coordenadas confirmadas directamente no Google Maps (não estimadas).
    // radius_m = 2500 é a decisão inicial; após o primeiro dry-run, avaliar:
    // quantidade de venues, sobreposição excessiva com Moema/Campo Belo/
    // Vila Olímpia/Berrini, cobertura efectiva do Brooklin, e custo estimado.
    // Reduzir o raio se houver muita sobreposição; aumentar se a cobertura
    // ficar insuficiente — ajuste de configuração, sem tocar arquitectura.
    { key: 'sp_brooklin_pilot', display_label: 'Brooklin, São Paulo', lat: -23.610110, lng: -46.686907, radius_m: 2500 },
    // 2ª onda da Regional Expansion (ADR-0021) — Campo Belo.
    // Centro técnico: Praça Pereira Coutinho, Campo Belo, São Paulo.
    // Coordenadas confirmadas directamente no Google Maps (não estimadas).
    // Definição operacional completa, incluindo candidatos descartados,
    // em docs/regional-baselines/campo-belo-definicao-operacional.md.
    // radius_m = 2500, mesmo critério do Brooklin — sem razão objectiva
    // para alterar nesta fase. Hipótese principal desta onda: validar o
    // comportamento do modelo de Regional Baselines quando duas regiões
    // vizinhas partilham naturalmente parte do mesmo ecossistema urbano
    // (ver docs/regional-baselines/campo-belo-planning.md).
    { key: 'campo_belo', display_label: 'Campo Belo, São Paulo', lat: -23.593029, lng: -46.669480, radius_m: 2500 },
    // Expansão do mercado Região dos Lagos (RJ) — completar cobertura
    // ao lado de Cabo Frio e Araruama, já reprocessadas com a Engine
    // actual (ver regional-baseline-report / snapshots correspondentes).
    // Coordenadas confirmadas directamente no Google Maps (não estimadas).
    // radius_m = 4000, deliberadamente conservador — cidade
    // significativamente menor que Cabo Frio/Araruama; evita
    // sobreposição forte com o raio de 12km de Cabo Frio, que fica
    // geograficamente próxima. Ajuste futuro (se necessário) baseado em
    // evidência do dry-run, não em suposição — mesma disciplina já
    // aplicada em Campo Belo. Definição operacional completa em
    // docs/regional-baselines/sao-pedro-da-aldeia-definicao-operacional.md.
    { key: 'sao_pedro_da_aldeia', display_label: 'São Pedro da Aldeia RJ', lat: -22.835174, lng: -42.098698, radius_m: 4000 },
    // Mesma onda de expansão do mercado Região dos Lagos, mesmo critério
    // de raio conservador de São Pedro da Aldeia. Definição operacional
    // completa em docs/regional-baselines/iguaba-grande-definicao-operacional.md.
    { key: 'iguaba_grande', display_label: 'Iguaba Grande RJ', lat: -22.839561, lng: -42.220774, radius_m: 4000 },
    // 3ª Regional Baseline da Região Metropolitana de SP (ADR-0021) —
    // Moema. Centro técnico: Praça Nossa Senhora Aparecida / Estação
    // Moema, no encontro da Av. Ibirapuera, Av. Moema e Av. Divino
    // Salvador. Coordenadas confirmadas directamente no Google Maps
    // (não estimadas). Definição operacional completa, incluindo
    // candidatos descartados (Parque Ibirapuera, Shopping Ibirapuera,
    // Aeroporto de Congonhas), em
    // docs/regional-baselines/moema-definicao-operacional.md.
    // radius_m = 2500, igual ao Brooklin e Campo Belo — deliberado,
    // para preservar comparabilidade directa entre Regional Baselines
    // em vez de optimizar cada raio isoladamente. Hipótese principal
    // desta onda: validar se o modelo de Regional Baselines continua
    // correcto quando TRÊS regiões vizinhas (Brooklin, Campo Belo,
    // Moema) partilham o mesmo ecossistema urbano — primeiro teste de
    // sobreposição não-binária (um venue pode ter sido descoberto por
    // qualquer uma de duas regiões anteriores, não só uma) — ver
    // docs/regional-baselines/moema-planning.md.
    { key: 'moema', display_label: 'Moema, São Paulo', lat: -23.60361, lng: -46.66194, radius_m: 2500 },

    { key: 'santo_amaro', display_label: 'Santo Amaro, Sao Paulo', lat: -23.65171, lng: -46.70693, radius_m: 2500 },
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


