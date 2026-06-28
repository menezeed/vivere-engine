import type { RawVenueItem } from '../../../types/RawVenueItem';

/**
 * Venue Filtering Engine — estágio de ADMISSÃO, não de classificação.
 *
 * Roda ANTES da classificação de categoria. Responde a uma pergunta
 * diferente: "isso pertence ao universo do Vida Ativa 60+?" — não
 * "qual categoria exata é isso?". Essa segunda pergunta continua
 * sendo responsabilidade exclusiva do estágio 04-classify-category,
 * que já existe e não é alterado por este módulo.
 *
 * Filosofia: igual aos outros estágios do pipeline (recorrência,
 * categoria, venue resolution) — regras pequenas, nomeadas e
 * auditáveis, nunca uma função monolítica de decisão. Nenhuma IA
 * nesta primeira versão: cada decisão precisa ser explicável citando
 * exatamente qual regra disparou.
 */
/**
 * Quarta categoria: 'likely_fitness_generic'.
 *
 * Existe porque a Places API não distingue, no campo google_types,
 * uma academia comum de uma academia que de fato oferece atividade
 * relevante para o público 60+ (hidroginástica, dança, etc). Isso é
 * uma limitação estrutural do DADO da fonte, não algo que o filtro
 * heurístico pode resolver com mais regras de tipo.
 *
 * NÃO é um nível de severidade entre 'accepted' e 'needs_review' — é
 * uma SUBCATEGORIA INFORMATIVA de revisão: sinaliza ao revisor humano
 * "provavelmente é só uma academia genérica, baixa prioridade", em
 * vez de tratá-lo como ambíguo de verdade (que é o que 'needs_review'
 * comunica). Itens 'likely_fitness_generic' nunca são promovidos
 * automaticamente — continuam exigindo decisão humana, só chegam
 * pré-triados por prioridade.
 */
export type VenueFilterDecision = 'accepted' | 'needs_review' | 'likely_fitness_generic' | 'rejected';

export type VenueFilterRuleId =
  // Camada 1 — rejeição por google_types
  | 'reject_type_government'
  | 'reject_type_finance'
  | 'reject_type_fuel'
  | 'reject_type_education_admin'
  | 'reject_type_private_no_public_activity'
  | 'reject_type_shopping_mall'
  | 'reject_type_grocery'
  | 'reject_type_sublocality_political'
  // Camada 2 — rejeição por palavra-chave no nome
  | 'reject_keyword_language_school'
  | 'reject_keyword_driving_school'
  | 'reject_keyword_legal_office'
  | 'reject_keyword_government_office'
  | 'reject_keyword_bank_branch'
  // Camada 3 — aceitação por google_types
  | 'accept_type_theater'
  | 'accept_type_museum'
  | 'accept_type_cultural_center'
  | 'accept_type_library'
  | 'accept_type_park'
  | 'accept_type_art_gallery'
  // Camada 3b — aceitação por palavra-chave (quando google_types não ajuda)
  | 'accept_keyword_convivencia'
  | 'accept_keyword_clube_social'
  | 'accept_keyword_espaco_cultural'
  // Camada 3c — reforço por nome quando a busca era activity_intent
  // (sinal mais forte que o tipo genérico do Google para o caso
  // hidroginástica/dança/natação)
  | 'accept_keyword_activity_name_match'
  // Camada 4 — casos intermediários, sempre vão para revisão
  | 'review_keyword_feira'
  | 'review_keyword_praca'
  | 'review_keyword_centro_historico'
  | 'review_keyword_monumento'
  | 'review_type_tourist_attraction'
  | 'review_type_food_uncertain'
  // Camada 5 — tipo genérico de fitness, sem nenhum reforço de nome
  | 'fitness_generic_type'
  // Default
  | 'default_no_rule_matched';

export interface VenueFilterRuleMatch {
  rule_id: VenueFilterRuleId;
  layer: 'reject' | 'accept' | 'review' | 'fitness_generic';
  matched_on: 'google_types' | 'name' | 'website' | 'name_or_website';
  matched_value: string; // o valor exato que disparou a regra — auditoria
}

export interface VenueFilterResult {
  decision: VenueFilterDecision;
  matches: VenueFilterRuleMatch[];   // TODAS as regras que dispararam, não só a decisiva
  decisive_layer: 'reject' | 'accept' | 'review' | 'fitness_generic' | 'default';
  reasoning: string;                  // frase legível, montada a partir dos matches — para o painel de revisão
}
