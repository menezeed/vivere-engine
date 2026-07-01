import type { RawVenueItem } from '../../../types/RawVenueItem';
import { decideVenueFilter } from './decideVenueFilter';
import { resolveRuleSet, type ResolvedRuleSet } from './resolveRuleSet';
import type { VenueFilterResult, VenueFilterRuleSet } from './types';

export type {
  VenueFilterDecision,
  VenueFilterResult,
  VenueFilterRuleMatch,
  VenueFilterRuleSet,
  TypeRule,
  KeywordRule,
  RuleCategoryOverride,
  AmbiguityFallbackRule,
} from './types';
export { decideVenueFilter } from './decideVenueFilter';
export { resolveRuleSet, type ResolvedRuleSet } from './resolveRuleSet';
export {
  DEFAULT_REJECT_TYPE_RULES,
  DEFAULT_REJECT_KEYWORD_RULES,
  DEFAULT_ACCEPT_TYPE_RULES,
} from './defaultRules';

export interface FilteredVenueItem<TRuleId extends string = string, TAmbiguityLabel extends string = never> {
  item: RawVenueItem;
  filter: VenueFilterResult<TRuleId, TAmbiguityLabel>;
}

/**
 * Processa uma lista de RawVenueItem (tipicamente a saída do
 * GooglePlacesCollector) usando o ruleSet de um produto específico,
 * e retorna cada item pareado com sua decisão de filtro. Não modifica
 * o RawVenueItem original — o resultado do filtro é um objeto
 * separado, para manter claro que isto é uma AVALIAÇÃO sobre o item,
 * não uma transformação dele.
 *
 * GENERALIZAÇÃO: aceita o ruleSet do produto (já resolvido com
 * defaults universais, ou um ResolvedRuleSet pré-computado) — este
 * módulo nunca importa configuração de nenhum produto específico.
 */
export function filterVenueItems<TRuleId extends string, TAmbiguityLabel extends string>(
  items: RawVenueItem[],
  productRuleSet: VenueFilterRuleSet<TRuleId, TAmbiguityLabel>,
): FilteredVenueItem<TRuleId, TAmbiguityLabel>[] {
  const resolved = resolveRuleSet(productRuleSet);
  return items.map((item) => ({
    item,
    filter: decideVenueFilter(item, resolved),
  }));
}

/**
 * Resumo por decisão. Genérico em relação ao label de ambiguidade do
 * produto: a contagem da quarta categoria usa o label real declarado
 * em ruleSet.ambiguity_fallback.label, nunca um literal fixo como
 * 'likely_fitness_generic'.
 */
export function summarizeFilterResults<TRuleId extends string, TAmbiguityLabel extends string>(
  results: FilteredVenueItem<TRuleId, TAmbiguityLabel>[],
  resolvedRuleSet: ResolvedRuleSet<TRuleId, TAmbiguityLabel>,
): {
  accepted: number;
  needs_review: number;
  rejected: number;
  ambiguity_fallback: number;
  ambiguity_fallback_label: TAmbiguityLabel;
} {
  const fallbackLabel = resolvedRuleSet.ambiguity_fallback.label;
  return {
    accepted: results.filter((r) => r.filter.decision === 'accepted').length,
    needs_review: results.filter((r) => r.filter.decision === 'needs_review').length,
    rejected: results.filter((r) => r.filter.decision === 'rejected').length,
    ambiguity_fallback: results.filter((r) => r.filter.decision === fallbackLabel).length,
    ambiguity_fallback_label: fallbackLabel,
  };
}
