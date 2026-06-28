/**
 * RawVenueItem — contrato de saída para Collectors que descobrem LOCAIS,
 * não atividades. Paralelo ao RawActivityItem, mas sem occurrences[],
 * sem recurrence_text_hint — porque a fonte não tem esse conceito.
 *
 * Regra de contrato (igual ao RawActivityItem): campos opcionais são
 * `null` explícito, nunca omitidos. Nenhuma interpretação de negócio
 * acontece aqui — isto é o dado "como a fonte disse", só limpo
 * mecanicamente (trim, encoding). Decisões de match contra venues
 * existentes, geocoding adicional, ou classificação de categoria
 * ficam para os estágios do pipeline, nunca para o Collector.
 */
export interface RawVenueItem {
  // --- Identidade da fonte ---
  source_key: string;            // 'google_places'
  source_item_id: string;        // place_id do Google — estável e único por lugar
  collected_at: string;          // ISO 8601

  // --- Conteúdo bruto, fiel à fonte ---
  name: string;
  address: string | null;
  lat: number;
  lng: number;

  phone: string | null;
  website: string | null;
  opening_hours_raw: string[] | null;   // weekdayDescriptions cru do Google, sem parsear
  image_url: string | null;             // null nesta fase — Photo API fica fora do modo seguro inicial

  // --- Sinal de categoria, NUNCA usado como category final direto ---
  source_category_hint: string;         // qual categoria da nossa lista gerou esta busca, ex: 'biblioteca'
  source_query_text: string;            // a query de texto exata enviada ao Google, para auditoria
  source_query_kind: 'place_type' | 'activity_intent'; // distingue "biblioteca" (lugar) de "dança para idosos" (atividade+público)

  google_types: string[];               // types[] bruto do Google — auditoria, nunca mapeado direto para category
  google_business_status: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';

  // --- Auditoria ---
  raw_payload: Record<string, unknown>; // resposta completa do Google para este place_id
}

export interface VenueCollectorError {
  source_item_id: string | null;
  message: string;
  raw_context: unknown | null;
}

export interface VenueCollectorResult {
  items: RawVenueItem[];
  errors: VenueCollectorError[];
  stats: {
    queries_executed: number;
    queries_skipped_budget: number;
    places_found_raw: number;       // antes de dedupe e filtro de closed_permanently
    places_returned: number;        // depois de dedupe
    estimated_cost_usd: number;
  };
}
