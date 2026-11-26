/**
 * Regras do Venue Filter do piloto UK (vivere-60-plus-uk-test, U2).
 *
 * Os venues da u3a vêm de uma fonte 60+ curada (não de pesquisa Google),
 * sem google_types. Sem regras de aceitação automática: todo o venue fica
 * 'needs_review' (default do filtro) para revisão humana no Engine Admin.
 * As regras universais de rejeição continuam a aplicar-se.
 */
import type { VenueFilterRuleSet } from '../types';
import type { UniversalVenueRuleId } from '../defaultRules';

export type VivereUkTestRuleId = UniversalVenueRuleId | 'uk_activity_name_match' | 'uk_no_ambiguity';
export type VivereUkTestAmbiguityLabel = 'uk_unused';

export const VIVERE_60_PLUS_UK_TEST_VENUE_FILTER_RULES: VenueFilterRuleSet<VivereUkTestRuleId, VivereUkTestAmbiguityLabel> = {
  accept_keyword: [],
  review_keyword: [],
  review_type: [],
  activity_name_reinforcement_keywords: [],
  activity_name_reinforcement_rule_id: 'uk_activity_name_match',
  ambiguity_fallback: {
    label: 'uk_unused',
    rule_id: 'uk_no_ambiguity',
    google_types: [],
    display_reason: 'Não usado no piloto UK (venues sem google_types)',
  },
};
