import { describe, it, expect } from 'vitest';
import { decideVenueFilter } from '../decideVenueFilter';
import { resolveRuleSet } from '../resolveRuleSet';
import type { VenueFilterRuleSet } from '../types';
import type { UniversalVenueRuleId } from '../defaultRules';
import { VIVERE_60_MAIS_VENUE_FILTER_RULES } from '../products/vivere-60-mais';
import type { RawVenueItem } from '../../../../types/RawVenueItem';

/**
 * Produto sintético hipotético — "Vivere Turismo" — com vocabulário e
 * quarta categoria de ambiguidade completamente diferentes do Vivere
 * 60+. Existe só para provar isolamento entre produtos, igual já
 * fizemos para os dois Collectors.
 */
type TurismoRuleId =
  | UniversalVenueRuleId
  | 'accept_keyword_pousada_familiar'
  | 'lodging_generic_type';

type TurismoAmbiguityLabel = 'likely_generic_lodging';

const TURISMO_RULES: VenueFilterRuleSet<TurismoRuleId, TurismoAmbiguityLabel> = {
  accept_keyword: [
    { rule_id: 'accept_keyword_pousada_familiar', keywords: ['pousada familiar'], matched_on: 'name' },
  ],
  review_keyword: [],
  review_type: [],
  activity_name_reinforcement_keywords: ['turismo', 'passeio'],
  activity_name_reinforcement_rule_id: 'accept_keyword_pousada_familiar',
  ambiguity_fallback: {
    label: 'likely_generic_lodging',
    rule_id: 'lodging_generic_type',
    google_types: ['lodging'],
    display_reason: 'Provável hospedagem genérica, sem indicação clara de perfil familiar',
  },
};

function makeItem(overrides: Partial<RawVenueItem>): RawVenueItem {
  return {
    source_key: 'google_places',
    source_item_id: 'test_id',
    collected_at: new Date().toISOString(),
    name: 'Lugar de teste',
    address: null,
    lat: -22.0,
    lng: -42.0,
    phone: null,
    website: null,
    opening_hours_raw: null,
    image_url: null,
    source_category_hint: 'teste',
    source_query_text: 'teste',
    source_query_kind: 'place_type',
    google_types: [],
    google_business_status: 'OPERATIONAL',
    raw_payload: {},
    ...overrides,
  };
}

describe('Generalização do Venue Filtering Engine — dois produtos, mesmo motor', () => {
  const vidaAtivaResolved = resolveRuleSet(VIVERE_60_MAIS_VENUE_FILTER_RULES);
  const turismoResolved = resolveRuleSet(TURISMO_RULES);

  it('Vivere 60+ produz "likely_fitness_generic" para academia sem reforço de nome', () => {
    const item = makeItem({ google_types: ['gym'] });
    const result = decideVenueFilter(item, vidaAtivaResolved);
    expect(result.decision).toBe('likely_fitness_generic');
  });

  it('produto sintético de turismo produz seu PRÓPRIO label "likely_generic_lodging" para o mesmo tipo de item (lodging)', () => {
    const item = makeItem({ google_types: ['lodging'] });
    const result = decideVenueFilter(item, turismoResolved);
    expect(result.decision).toBe('likely_generic_lodging');
  });

  it('o produto de turismo NUNCA produz o label do Vivere 60+, mesmo com tipo "gym"', () => {
    const item = makeItem({ google_types: ['gym'] });
    const result = decideVenueFilter(item, turismoResolved);
    // gym não está no ambiguity_fallback do turismo (que é 'lodging'),
    // então cai no default — needs_review, nunca 'likely_fitness_generic'
    expect(result.decision).not.toBe('likely_fitness_generic');
    expect(result.decision).toBe('needs_review');
  });

  it('ambos os produtos herdam o MESMO default universal (rejeitar banco), sem duplicar a regra', () => {
    const item = makeItem({ name: 'Banco do Brasil', google_types: ['bank'] });
    expect(decideVenueFilter(item, vidaAtivaResolved).decision).toBe('rejected');
    expect(decideVenueFilter(item, turismoResolved).decision).toBe('rejected');
  });

  it('ambos os produtos herdam o MESMO default universal (aceitar museu), sem duplicar a regra', () => {
    const item = makeItem({ name: 'Museu Local', google_types: ['museum'] });
    expect(decideVenueFilter(item, vidaAtivaResolved).decision).toBe('accepted');
    expect(decideVenueFilter(item, turismoResolved).decision).toBe('accepted');
  });

  it('regras de aceitação por palavra-chave são totalmente isoladas entre produtos', () => {
    const itemConvivencia = makeItem({ name: 'Centro de Convivência do Idoso', google_types: ['establishment'] });
    const itemPousada = makeItem({ name: 'Pousada Familiar do Mar', google_types: ['establishment'] });

    // "Centro de Convivência" é aceito pelo Vivere 60+, mas não tem
    // regra equivalente no produto de turismo sintético
    expect(decideVenueFilter(itemConvivencia, vidaAtivaResolved).decision).toBe('accepted');
    expect(decideVenueFilter(itemConvivencia, turismoResolved).decision).toBe('needs_review');

    // "Pousada Familiar" é aceito pelo turismo, mas não tem regra
    // equivalente no Vivere 60+
    expect(decideVenueFilter(itemPousada, turismoResolved).decision).toBe('accepted');
    expect(decideVenueFilter(itemPousada, vidaAtivaResolved).decision).toBe('needs_review');
  });

  it('weak_review_rule_ids do Vivere 60+ (tourist_attraction) não afeta o produto de turismo, que não declarou essa regra', () => {
    const item = makeItem({ name: 'Forte Histórico', google_types: ['tourist_attraction', 'museum'] });
    // Vivere 60+: tourist_attraction é fraco, museum (accept) prevalece
    expect(decideVenueFilter(item, vidaAtivaResolved).decision).toBe('accepted');
    // Turismo: não declarou review_type nem weak_review_rule_ids — o
    // museum (default universal de accept) ainda prevalece, mas por
    // não haver NENHUM review match disparando no produto de turismo
    expect(decideVenueFilter(item, turismoResolved).decision).toBe('accepted');
  });
});

describe('Generalização — extend vs override de categoria universal', () => {
  type ExtendRuleId = UniversalVenueRuleId | 'accept_type_aquarium';
  const EXTEND_PRODUCT: VenueFilterRuleSet<ExtendRuleId, 'likely_x'> = {
    accept_type: { mode: 'extend', rules: [{ rule_id: 'accept_type_aquarium', google_types: ['aquarium'] }] },
    accept_keyword: [],
    review_keyword: [],
    review_type: [],
    activity_name_reinforcement_keywords: [],
    activity_name_reinforcement_rule_id: 'accept_type_aquarium',
    ambiguity_fallback: { label: 'likely_x', rule_id: 'accept_type_aquarium', google_types: [], display_reason: '' },
  };

  type OverrideRuleId = UniversalVenueRuleId | 'accept_type_aquarium';
  const OVERRIDE_PRODUCT: VenueFilterRuleSet<OverrideRuleId, 'likely_y'> = {
    accept_type: { mode: 'override', rules: [{ rule_id: 'accept_type_aquarium', google_types: ['aquarium'] }] },
    accept_keyword: [],
    review_keyword: [],
    review_type: [],
    activity_name_reinforcement_keywords: [],
    activity_name_reinforcement_rule_id: 'accept_type_aquarium',
    ambiguity_fallback: { label: 'likely_y', rule_id: 'accept_type_aquarium', google_types: [], display_reason: '' },
  };

  it('modo extend: produto soma sua regra aos defaults universais, museu continua aceito', () => {
    const resolved = resolveRuleSet(EXTEND_PRODUCT);
    const museu = decideVenueFilter(makeItem({ google_types: ['museum'] }), resolved);
    const aquario = decideVenueFilter(makeItem({ google_types: ['aquarium'] }), resolved);
    expect(museu.decision).toBe('accepted');
    expect(aquario.decision).toBe('accepted');
  });

  it('modo override: produto substitui os defaults por completo, museu deixa de ser aceito automaticamente', () => {
    const resolved = resolveRuleSet(OVERRIDE_PRODUCT);
    const museu = decideVenueFilter(makeItem({ google_types: ['museum'] }), resolved);
    const aquario = decideVenueFilter(makeItem({ google_types: ['aquarium'] }), resolved);
    expect(museu.decision).toBe('needs_review'); // não está mais nos accept_type deste produto
    expect(aquario.decision).toBe('accepted');
  });
});
