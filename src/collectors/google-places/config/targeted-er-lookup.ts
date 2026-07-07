import type { GooglePlacesProductConfig } from './GooglePlacesProductConfig.js';

/**
 * Ingestão DIRECCIONADA — venues mencionados pelas actividades reais.
 *
 * PROPÓSITO:
 * As 8 actividades ingeridas da Prefeitura de Cabo Frio mencionam venues
 * (Forte São Mateus, Praia do Forte, Museu José de Dome, etc.) que NÃO
 * foram capturados pela ingestão principal das 7 categorias.
 * Esta config faz uma busca directa por esses venues para enriquecer o
 * pool approved/promoted antes da calibração do Entity Resolution Engine.
 *
 * REGRAS:
 * — product_key = vivere-60-mais (mesmo produto, sem separação)
 * — source_key = google_places (mesmo source — a fonte é a mesma)
 * — source_category_hint = targeted_venue_lookup (marca os itens)
 * — Uma região única: centro de Cabo Frio com raio pequeno (3km)
 * — 8 queries directas, uma por venue mencionado
 * — Budget separado: USD 1.00 máximo (~31 queries × $0.032)
 * — Não mistura com as 7 categorias principais
 * — Não altera a config principal vivere-60-mais.ts
 *
 * CUSTO ESTIMADO:
 * 8 queries × 1 região × $0.032 = $0.256 (~25 cêntimos)
 * Cada query pode precisar de enriquecimento (+1 call) → máx $0.51
 *
 * USO:
 *   dry-run:  npx tsx --env-file=.env scripts/dry-run-google-places.ts --product=targeted-er-lookup
 *   real:     npx tsx --env-file=.env scripts/ingest-google-places.ts --product=targeted-er-lookup
 */
export const TARGETED_ER_LOOKUP_CONFIG: GooglePlacesProductConfig = {
  product_key:     'vivere-60-mais',   // mesmo produto — venues vão para o mesmo pool
  source_key:      'google_places',
  source_priority: 70,

  regions: [
    // Centro de Cabo Frio — raio de 3km cobre todos os venues históricos e culturais
    {
      key:           'cabo_frio_centro',
      display_label: 'Cabo Frio RJ',
      lat:           -22.8806,
      lng:           -42.0187,
      radius_m:      3000,
    },
  ],

  categories: [
    // Venues directamente mencionados pelas actividades reais
    { key: 'forte_sao_mateus',    query_text: 'Forte São Mateus Cabo Frio',              kind: 'place_type' },
    { key: 'praia_do_forte',      query_text: 'Praia do Forte Cabo Frio',                kind: 'place_type' },
    { key: 'museu_jose_dome',     query_text: 'Museu José de Dome Cabo Frio',            kind: 'place_type' },
    { key: 'charitas',            query_text: 'Casa de Cultura Charitas Cabo Frio',      kind: 'place_type' },
    { key: 'palacio_aguias',      query_text: 'Palácio das Águias Cabo Frio',            kind: 'place_type' },
    { key: 'praca_moinho',        query_text: 'Praça do Moinho Cabo Frio',               kind: 'place_type' },
    { key: 'praca_bandeira',      query_text: 'Praça da Bandeira Passagem Cabo Frio',   kind: 'place_type' },
    { key: 'canto_do_forte',      query_text: 'Canto do Forte Praia do Forte Cabo Frio', kind: 'place_type' },
  ],

  // Budget mínimo — ingestão pequena e controlada
  monthly_budget_usd:   1.00,
  hard_stop_enabled:    true,
  alert_threshold_pct:  0.8,
};
