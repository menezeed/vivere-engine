import type { RawVenueItem } from '../../../types/RawVenueItem';

/**
 * Venue Filtering Engine — estágio de ADMISSÃO, não de classificação.
 *
 * Roda ANTES da classificação de categoria. Responde a uma pergunta
 * que depende do produto: "isso pertence ao universo deste produto
 * Vivere?" — não "qual categoria exata é isso?" (responsabilidade do
 * estágio de classificação de categoria, que não é alterado por este
 * módulo).
 *
 * GENERALIZAÇÃO (ver ARCHITECTURE_EVOLUTION.md): este motor não
 * conhece nenhum produto específico. Os tipos abaixo são parametrizados
 * por dois generics que cada produto declara:
 *   - TRuleId: o universo de identificadores de regra daquele produto
 *     (defaults universais do motor + regras específicas do produto)
 *   - TAmbiguityLabel: as categorias de ambiguidade "subcategoria de
 *     revisão" daquele produto (ex: 'likely_fitness_generic' para o
 *     Vivere 60+; um produto futuro pode declarar outra, como
 *     'likely_generic_lodging' para o Vivere Turismo)
 *
 * Isso preserva tipagem forte (erro de digitação ou mistura de
 * vocabulário entre produtos é pego em tempo de compilação) sem o
 * motor precisar conhecer os valores reais de nenhum produto —
 * decisão tomada explicitamente em vez de abrir rule_id para string
 * livre (ver discussão registrada em ARCHITECTURE_EVOLUTION.md).
 */

export type VenueFilterDecision<TAmbiguityLabel extends string = never> =
  | 'accepted'
  | 'needs_review'
  | 'rejected'
  | TAmbiguityLabel;

export interface VenueFilterRuleMatch<TRuleId extends string = string> {
  rule_id: TRuleId;
  layer: 'reject' | 'accept' | 'review' | 'ambiguity_fallback';
  matched_on: 'google_types' | 'name' | 'website' | 'name_or_website';
  matched_value: string; // o valor exato que disparou a regra — auditoria
}

export interface VenueFilterResult<TRuleId extends string = string, TAmbiguityLabel extends string = never> {
  decision: VenueFilterDecision<TAmbiguityLabel>;
  matches: VenueFilterRuleMatch<TRuleId>[]; // TODAS as regras que dispararam, não só a decisiva
  decisive_layer: 'reject' | 'accept' | 'review' | 'ambiguity_fallback' | 'default';
  reasoning: string; // frase legível, montada a partir dos matches — para o painel de revisão
}

export interface TypeRule<TRuleId extends string> {
  rule_id: TRuleId;
  google_types: string[];
}

export interface KeywordRule<TRuleId extends string> {
  rule_id: TRuleId;
  keywords: string[];
  matched_on: 'name' | 'website' | 'name_or_website';
}

/**
 * Uma categoria de regra pode ser estendida (somada aos defaults
 * universais do motor) ou sobrescrita (substitui os defaults por
 * completo) — nunca as duas coisas ao mesmo tempo na mesma categoria,
 * para a composição nunca ser ambígua. Sem override declarado, o
 * produto herda os defaults integralmente.
 */
export type RuleCategoryOverride<TRule> = { mode: 'extend'; rules: TRule[] } | { mode: 'override'; rules: TRule[] };

export interface AmbiguityFallbackRule<TRuleId extends string, TAmbiguityLabel extends string> {
  label: TAmbiguityLabel;
  rule_id: TRuleId;
  google_types: string[];
  display_reason: string; // frase legível usada no reasoning, ex: "Provável academia genérica..."
}

/**
 * Configuração completa de regras de um produto: defaults universais
 * do motor (sempre presentes, a menos que o produto explicitamente
 * sobrescreva uma categoria) compostos com o que o produto declara.
 *
 * Categorias consideradas universais — características gerais de
 * lugar físico, não preferência de público-alvo (decisão registrada
 * em ARCHITECTURE_EVOLUTION.md): reject_type, reject_keyword,
 * accept_type. Categorias sempre específicas de produto:
 * accept_keyword, review_keyword, review_type,
 * activity_name_reinforcement_keywords, ambiguity_fallback — todo
 * produto que usar este motor declara as suas, não há default
 * universal sensato para nenhuma delas.
 */
export interface VenueFilterRuleSet<TRuleId extends string, TAmbiguityLabel extends string> {
  reject_type?: RuleCategoryOverride<TypeRule<TRuleId>>;
  reject_keyword?: RuleCategoryOverride<KeywordRule<TRuleId>>;
  accept_type?: RuleCategoryOverride<TypeRule<TRuleId>>;
  accept_keyword: KeywordRule<TRuleId>[];
  review_keyword: KeywordRule<TRuleId>[];
  review_type: TypeRule<TRuleId>[];
  /**
   * rule_id de revisão considerados "sinal fraco": quando TODOS os
   * matches de review presentes vêm exclusivamente destes rule_id, E
   * já existe um match de accept específico, a aceitação prevalece —
   * o sinal fraco não deveria "afogar" uma classificação já confiável.
   * Ex. real do Vivere 60+: 'review_type_tourist_attraction' (o Google
   * atribui esse tipo a quase qualquer marco turístico, em paralelo a
   * tipos bem mais específicos como museum/cultural_center).
   */
  weak_review_rule_ids?: TRuleId[];
  activity_name_reinforcement_keywords: string[];
  activity_name_reinforcement_rule_id: TRuleId; // rule_id próprio, distinto do rule_id do ambiguity_fallback
  ambiguity_fallback: AmbiguityFallbackRule<TRuleId, TAmbiguityLabel>;
}

export type { RawVenueItem };
