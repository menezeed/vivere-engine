import type { KeywordRule, RuleCategoryOverride, TypeRule, VenueFilterRuleSet } from './types';
import { DEFAULT_ACCEPT_TYPE_RULES, DEFAULT_REJECT_KEYWORD_RULES, DEFAULT_REJECT_TYPE_RULES } from './defaultRules';

/**
 * Resolve uma categoria de regra: sem override declarado, herda o
 * default universal integralmente; com override em modo 'extend',
 * soma às regras do produto; em modo 'override', substitui por
 * completo. Mecanismo validado por prova de conceito antes de ser
 * aplicado aqui (ver ARCHITECTURE_EVOLUTION.md).
 */
function resolveCategory<TRule>(defaults: TRule[], override: RuleCategoryOverride<TRule> | undefined): TRule[] {
  if (!override) return defaults;
  if (override.mode === 'override') return override.rules;
  return [...defaults, ...override.rules];
}

export interface ResolvedRuleSet<TRuleId extends string, TAmbiguityLabel extends string> {
  reject_type: TypeRule<TRuleId>[];
  reject_keyword: KeywordRule<TRuleId>[];
  accept_type: TypeRule<TRuleId>[];
  accept_keyword: KeywordRule<TRuleId>[];
  review_keyword: KeywordRule<TRuleId>[];
  review_type: TypeRule<TRuleId>[];
  weak_review_rule_ids: TRuleId[];
  activity_name_reinforcement_keywords: string[];
  activity_name_reinforcement_rule_id: TRuleId;
  ambiguity_fallback: VenueFilterRuleSet<TRuleId, TAmbiguityLabel>['ambiguity_fallback'];
}

/**
 * TRuleId de qualquer produto deve INCLUIR UniversalVenueRuleId na
 * sua composição (ex: `type MeuProdutoRuleId = UniversalVenueRuleId |
 * 'minha_regra_especifica'`) — isso é responsabilidade de quem
 * declara o tipo do produto (ver products/vivere-60-mais.ts), não
 * uma constraint imposta aqui. Os defaults universais são sempre um
 * subconjunto válido de qualquer TRuleId construído dessa forma; o
 * cast abaixo expressa exatamente essa garantia de composição, não
 * uma conversão insegura de tipos não relacionados.
 */
export function resolveRuleSet<TRuleId extends string, TAmbiguityLabel extends string>(
  productRuleSet: VenueFilterRuleSet<TRuleId, TAmbiguityLabel>,
): ResolvedRuleSet<TRuleId, TAmbiguityLabel> {
  return {
    reject_type: resolveCategory(
      DEFAULT_REJECT_TYPE_RULES as unknown as TypeRule<TRuleId>[],
      productRuleSet.reject_type,
    ),
    reject_keyword: resolveCategory(
      DEFAULT_REJECT_KEYWORD_RULES as unknown as KeywordRule<TRuleId>[],
      productRuleSet.reject_keyword,
    ),
    accept_type: resolveCategory(
      DEFAULT_ACCEPT_TYPE_RULES as unknown as TypeRule<TRuleId>[],
      productRuleSet.accept_type,
    ),
    accept_keyword: productRuleSet.accept_keyword,
    review_keyword: productRuleSet.review_keyword,
    review_type: productRuleSet.review_type,
    weak_review_rule_ids: productRuleSet.weak_review_rule_ids ?? [],
    activity_name_reinforcement_keywords: productRuleSet.activity_name_reinforcement_keywords,
    activity_name_reinforcement_rule_id: productRuleSet.activity_name_reinforcement_rule_id,
    ambiguity_fallback: productRuleSet.ambiguity_fallback,
  };
}
