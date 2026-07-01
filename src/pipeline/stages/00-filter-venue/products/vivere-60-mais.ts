import type { VenueFilterRuleSet } from '../types';
import type { UniversalVenueRuleId } from '../defaultRules';

/**
 * Configuração do Venue Filtering Engine para o produto Vivere 60+.
 *
 * Migrado de ruleLists.ts (versão pré-generalização, ver
 * ARCHITECTURE_EVOLUTION.md). As regras universais de lugar físico
 * (rejeitar banco/posto/shopping, aceitar teatro/museu/biblioteca)
 * NÃO estão aqui — são defaults herdados do motor
 * (defaultRules.ts). Este arquivo só declara o que é específico
 * deste produto: vocabulário de público-alvo, a quarta categoria de
 * ambiguidade, e as regras de revisão próprias.
 */

export type VivereSessentaMaisRuleId =
  | UniversalVenueRuleId
  // Aceitação por palavra-chave (quando google_types não ajuda)
  | 'accept_keyword_convivencia'
  | 'accept_keyword_clube_social'
  | 'accept_keyword_espaco_cultural'
  // Reforço por nome quando a busca era activity_intent
  | 'accept_keyword_activity_name_match'
  // Casos intermediários — sempre vão para revisão
  | 'review_keyword_feira'
  | 'review_keyword_praca'
  | 'review_keyword_centro_historico'
  | 'review_keyword_monumento'
  | 'review_type_tourist_attraction'
  | 'review_type_food_uncertain'
  // Fallback de ambiguidade — tipo genérico de fitness, sem reforço de nome
  | 'fitness_generic_type';

export type VivereSessentaMaisAmbiguityLabel = 'likely_fitness_generic';

export const VIVERE_60_MAIS_VENUE_FILTER_RULES: VenueFilterRuleSet<
  VivereSessentaMaisRuleId,
  VivereSessentaMaisAmbiguityLabel
> = {
  // reject_type, reject_keyword, accept_type: sem override — este
  // produto herda os defaults universais do motor integralmente.

  accept_keyword: [
    {
      rule_id: 'accept_keyword_convivencia',
      keywords: ['centro de convivencia', 'centro de convivência', 'centro do idoso', 'centro da terceira idade'],
      matched_on: 'name',
    },
    {
      rule_id: 'accept_keyword_clube_social',
      keywords: ['clube social', 'clube recreativo', 'associacao recreativa', 'associação recreativa'],
      matched_on: 'name',
    },
    {
      rule_id: 'accept_keyword_espaco_cultural',
      keywords: ['espaco cultural', 'espaço cultural'],
      matched_on: 'name',
    },
  ],

  review_keyword: [
    { rule_id: 'review_keyword_feira', keywords: ['feira de', 'feira livre', 'feira municipal'], matched_on: 'name' },
    { rule_id: 'review_keyword_praca', keywords: ['praca ', 'praça '], matched_on: 'name' },
    {
      rule_id: 'review_keyword_centro_historico',
      keywords: ['centro historico', 'centro histórico'],
      matched_on: 'name',
    },
    { rule_id: 'review_keyword_monumento', keywords: ['monumento', 'memorial'], matched_on: 'name' },
  ],

  review_type: [
    { rule_id: 'review_type_tourist_attraction', google_types: ['tourist_attraction'] },
    {
      // restaurant/food vai para revisão, NÃO rejeição: existe a
      // possibilidade real de um evento social para o público 60+
      // (ex: "almoço dançante") ocorrer num restaurante. Diferente de
      // shopping_mall/grocery_store, que não têm esse caso de uso
      // plausível, aqui a decisão consciente foi manter reversível.
      rule_id: 'review_type_food_uncertain',
      google_types: ['restaurant', 'food', 'cafe', 'bar'],
    },
  ],

  // tourist_attraction é tipo demais genérico (o Google atribui a
  // quase qualquer marco turístico) — quando coexiste com um accept
  // específico (museum, cultural_center), o accept prevalece.
  weak_review_rule_ids: ['review_type_tourist_attraction'],

  // Vocabulário de público-alvo — específico deste produto. Aplicado
  // SOMENTE a itens de busca activity_intent (hidroginástica, dança
  // para idosos), sinal mais forte que o google_types genérico do
  // Google para academias/estúdios, porque o Google não distingue uma
  // academia comum de uma que de fato oferece a atividade buscada.
  activity_name_reinforcement_keywords: [
    'hidroginastica', 'hidroginástica',
    'natacao', 'natação',
    'danca', 'dança',
    'terceira idade', 'idosos', 'idoso',
    'aquatica', 'aquática', 'aquafit', 'aqua',
  ],
  activity_name_reinforcement_rule_id: 'accept_keyword_activity_name_match',

  // Quarta categoria de ambiguidade: existe porque a Places API não
  // distingue, no campo google_types, uma academia comum de uma que
  // de fato oferece atividade relevante para o público 60+. Isso é
  // uma limitação estrutural do DADO da fonte, não algo que regras de
  // tipo adicionais resolveriam.
  ambiguity_fallback: {
    label: 'likely_fitness_generic',
    rule_id: 'fitness_generic_type',
    google_types: [
      'gym', 'fitness_center', 'sports_activity_location', 'sports_club',
      'sports_school', 'sports_complex', 'health', 'yoga_studio',
    ],
    display_reason: 'Provável academia/estúdio genérico, sem indicação clara de atender o público 60+',
  },
};
