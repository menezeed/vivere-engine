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
 *
 * AJUSTE DE CONTRATO (Fase 3 — ver estudo de modelo de entidades,
 * registrado antes do desenho de staging): o campo de venue mudou de
 * seis campos soltos (venue_name/venue_address/venue_lat/venue_lng/
 * venue_phone/venue_website) para uma única VenueMention.
 *
 * Motivo: uma fonte de atividade NUNCA tem autoridade epistêmica
 * para afirmar latitude/longitude/telefone/website de um venue — ela
 * só pode relatar o que o texto da fonte disse sobre o local. Os
 * cinco campos antigos além de venue_name nunca foram preenchidos por
 * nenhum Collector real (confirmado antes desta mudança) — eram
 * "venue completo" simulado dentro de um contrato que só pode
 * honestamente expressar "menção textual de venue". A resolução de
 * qual venue real (com coordenadas, telefone, etc.) corresponde a
 * essa menção é responsabilidade do Entity Resolution, sobre
 * staging — nunca do Collector. RawVenueItem (Google Places e
 * equivalentes) permanece com os campos completos, porque essas
 * fontes TÊM autoridade para afirmá-los.
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

  // --- Local: uma AFIRMAÇÃO textual, não um venue resolvido ---
  venue_mention: VenueMention | null;  // null quando a fonte não menciona nenhum local

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

/**
 * Uma afirmação textual de uma fonte de atividade sobre onde o
 * evento acontece — não uma referência a um venue resolvido. A
 * resolução (qual venue real, com coordenadas e contato, corresponde
 * a esta menção) é trabalho do Entity Resolution sobre staging,
 * nunca do Collector.
 *
 * `confidence_hint` distingue o quão diretamente a fonte declarou o
 * local: 'explicit_name' quando há um nome de lugar claro e isolado
 * (ex: bloco estruturado "Local: Forte São Mateus"); 'inferred_from_context'
 * quando o nome foi extraído de uma frase narrativa mais ampla, com
 * mais chance de ruído; 'ambiguous' quando a própria extração já
 * identificou incerteza sobre se o texto correspondente é de fato um
 * nome de local. Este hint não é uma decisão de Entity Resolution —
 * é só a honestidade do Collector sobre a qualidade do que extraiu.
 */
export interface VenueMention {
  raw_text: string;                  // exatamente o texto que a fonte usou para se referir ao local
  raw_address_text: string | null;   // endereço mencionado em texto livre, se houver — nunca geocodificado aqui
  confidence_hint: 'explicit_name' | 'inferred_from_context' | 'ambiguous';
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
