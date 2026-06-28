/**
 * RawActivityItem — contrato de saída para Collectors que descobrem
 * ATIVIDADES (eventos, aulas, programações), em contraste com
 * RawVenueItem, que é para Collectors que descobrem apenas LOCAIS.
 *
 * Este é o contrato original do VAIP, definido antes mesmo de
 * RawVenueItem ter sido criado (que surgiu como uma necessidade
 * específica do Google Places, fonte que não tem conceito de
 * atividade). Até a implementação do WordPressContentCollector
 * (originalmente nomeado PrefeituraAgendaCulturalCollector, antes da
 * generalização da plataforma Vivere — ver ARCHITECTURE_EVOLUTION.md),
 * este tipo só existia em prosa nas conversas de design — esta foi a
 * primeira vez que ele foi formalizado como código.
 *
 * Mesma regra de contrato de todos os Collectors: campos opcionais
 * são `null` explícito, nunca omitidos. Nenhuma interpretação de
 * negócio acontece aqui — isto é o dado "como a fonte disse", só
 * limpo mecanicamente (trim, encoding). Decisões de recorrência,
 * categoria, venue resolution, dedupe e score ficam para os estágios
 * do pipeline, nunca para o Collector.
 */
export interface RawActivityItem {
  // --- Identidade da fonte ---
  source_key: string;            // ex: 'prefeitura_cabo_frio'
  source_item_id: string;        // único e estável dentro da fonte
  collected_at: string;          // ISO 8601

  // --- Conteúdo bruto, fiel à fonte ---
  title: string;                 // obrigatório, trim + encoding normalizado
  description: string | null;
  raw_category_text: string | null;  // sinal bruto de categoria, se a fonte tiver — NUNCA é um categories.key

  // --- Ocorrências brutas (não interpretadas) ---
  occurrences: RawOccurrence[];
  recurrence_text_hint: string | null;  // texto livre que SUGERE recorrência, nunca interpretado aqui

  // --- Local ---
  venue_name: string | null;
  venue_address: string | null;
  venue_lat: number | null;
  venue_lng: number | null;
  venue_phone: string | null;
  venue_website: string | null;

  // --- Comercial ---
  price_text: string | null;     // texto bruto, ex: "Gratuito", "R$ 20" — parsing fica no normalizador
  is_free_hint: boolean | null;  // true/false se a fonte declara explicitamente, null se ambíguo/ausente

  // --- Mídia e contato ---
  image_url: string | null;
  external_url: string | null;   // link da fonte original
  contact_phone: string | null;
  contact_email: string | null;

  // --- Idioma ---
  language: 'pt' | 'en' | null;

  // --- Auditoria ---
  raw_payload: Record<string, unknown>;  // o JSON/HTML original ou snapshot relevante, sem transformação
}

export interface RawOccurrence {
  date: string;          // 'YYYY-MM-DD', obrigatório
  time: string | null;   // 'HH:MM' 24h — horário de INÍCIO apenas; null se a fonte não informa
  end_date: string | null;   // para eventos multi-dia
  end_time: string | null;   // horário de término, quando informado — separado de `time`, nunca um range no mesmo campo
}

export interface ActivityCollectorError {
  source_item_id: string | null;
  message: string;
  raw_context: unknown | null;
}

export interface ActivityCollectorResult {
  items: RawActivityItem[];
  errors: ActivityCollectorError[];
  stats: {
    posts_fetched: number;
    posts_rejected_by_relevance: number;
    posts_parsed_structured_block: number;
    posts_parsed_narrative_fallback: number;
    posts_no_extractable_schedule: number;
    items_returned: number;
  };
}
