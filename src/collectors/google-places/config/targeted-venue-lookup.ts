/**
 * src/collectors/google-places/config/targeted-venue-lookup.ts
 *
 * Configuração de ingestão DIRECCIONADA para venues específicos
 * mencionados nas VenueMentions das actividades actuais.
 *
 * PROPÓSITO:
 * As actividades da Prefeitura de Cabo Frio mencionam venues (Forte São
 * Mateus, Museu José de Dome, Palácio das Águias, etc.) que não foram
 * capturados pela ingestão regular das 7 categorias. Esta configuração
 * faz queries específicas para cada venue mencionado.
 *
 * DIFERENÇA da ingestão regular:
 * — source_category_hint = 'targeted_venue_lookup' (identifica no banco)
 * — Queries por nome exacto (place_type) em vez de categoria genérica
 * — Apenas Cabo Frio (onde estão as actividades com VenueMentions)
 * — Orçamento separado e pequeno (~8 queries × $0.032 = ~$0.26)
 *
 * REGRAS:
 * — Não altera a arquitectura do motor
 * — Mantém product_key = vivere-60-mais
 * — Não mistura com as 7 categorias principais
 * — Resultados revistos manualmente no Admin Panel antes do resolveAll
 */

import type { GooglePlacesProductConfig } from './GooglePlacesProductConfig.js';

export const TARGETED_VENUE_LOOKUP_CONFIG: GooglePlacesProductConfig = {
  product_key:      'vivere-60-mais',
  source_key:       'google_places',
  source_priority:  70,

  // Apenas Cabo Frio — onde estão as actividades com VenueMentions
  regions: [
    {
      key:           'cabo_frio_targeted',
      display_label: 'Cabo Frio RJ',
      lat:           -22.8894,
      lng:           -42.0188,
      radius_m:      8000,  // raio menor — venues urbanos específicos
    },
  ],

  // Um venue mencionado por actividade — queries por nome exacto
  categories: [
    {
      key:        'forte_sao_mateus',
      query_text: 'Forte São Mateus',
      kind:       'place_type',
    },
    {
      key:        'praia_do_forte',
      query_text: 'Praia do Forte Cabo Frio',
      kind:       'place_type',
    },
    {
      key:        'museu_jose_dome',
      query_text: 'Museu José de Dome Cabo Frio',
      kind:       'place_type',
    },
    {
      key:        'charitas',
      query_text: 'Charitas Cabo Frio',
      kind:       'place_type',
    },
    {
      key:        'palacio_aguias',
      query_text: 'Palácio das Águias Cabo Frio',
      kind:       'place_type',
    },
    {
      key:        'praca_moinho',
      query_text: 'Praça do Moinho Cabo Frio',
      kind:       'place_type',
    },
    {
      key:        'passagem_cabo_frio',
      query_text: 'Passagem Cabo Frio bairro',
      kind:       'place_type',
    },
    {
      key:        'canto_do_forte',
      query_text: 'Canto do Forte Cabo Frio',
      kind:       'place_type',
    },
  ],

  // Orçamento próprio — separado das 7 categorias principais
  // 8 queries × $0.032 = ~$0.26 estimado
  monthly_budget_usd:  2.0,
  hard_stop_enabled:   true,
  alert_threshold_pct: 0.9,
};
