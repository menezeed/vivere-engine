import type { RawVenueItem } from '../../../types/RawVenueItem';
import { decideVenueFilter } from './decideVenueFilter';
import type { VenueFilterResult } from './types';

export type { VenueFilterDecision, VenueFilterResult, VenueFilterRuleMatch, VenueFilterRuleId } from './types';
export { decideVenueFilter } from './decideVenueFilter';

export interface FilteredVenueItem {
  item: RawVenueItem;
  filter: VenueFilterResult;
}

/**
 * Processa uma lista de RawVenueItem (tipicamente a saída do
 * GooglePlacesCollector) e retorna cada item pareado com sua decisão
 * de filtro. Não modifica o RawVenueItem original — o resultado do
 * filtro é um objeto separado, para manter claro que isto é uma
 * AVALIAÇÃO sobre o item, não uma transformação dele.
 */
export function filterVenueItems(items: RawVenueItem[]): FilteredVenueItem[] {
  return items.map((item) => ({
    item,
    filter: decideVenueFilter(item),
  }));
}

export function summarizeFilterResults(results: FilteredVenueItem[]): {
  accepted: number;
  needs_review: number;
  likely_fitness_generic: number;
  rejected: number;
} {
  return {
    accepted: results.filter((r) => r.filter.decision === 'accepted').length,
    needs_review: results.filter((r) => r.filter.decision === 'needs_review').length,
    likely_fitness_generic: results.filter((r) => r.filter.decision === 'likely_fitness_generic').length,
    rejected: results.filter((r) => r.filter.decision === 'rejected').length,
  };
}
