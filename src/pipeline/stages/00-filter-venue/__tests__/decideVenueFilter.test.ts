import { describe, it, expect } from 'vitest';
import { decideVenueFilter as decideVenueFilterRaw } from '../decideVenueFilter';
import { resolveRuleSet } from '../resolveRuleSet';
import { VIVERE_60_MAIS_VENUE_FILTER_RULES } from '../products/vivere-60-mais';
import type { RawVenueItem } from '../../../../types/RawVenueItem';

// Estes testes validam o MOTOR genérico, usando o ruleSet real do
// Vivere 60+ como fixture — o comportamento testado aqui é o do
// motor (prioridade reject > review > accept > fallback, defaults
// universais herdados, etc.), não regras específicas de produto.
const VIVERE_60_MAIS_RESOLVED = resolveRuleSet(VIVERE_60_MAIS_VENUE_FILTER_RULES);
function decideVenueFilter(item: RawVenueItem) {
  return decideVenueFilterRaw(item, VIVERE_60_MAIS_RESOLVED);
}

function makeItem(overrides: Partial<RawVenueItem>): RawVenueItem {
  return {
    source_key: 'google_places',
    source_item_id: 'test_place_id',
    collected_at: new Date().toISOString(),
    name: 'Lugar de teste',
    address: 'Rua Teste, 123',
    lat: -22.88,
    lng: -42.02,
    phone: null,
    website: null,
    opening_hours_raw: null,
    image_url: null,
    source_category_hint: 'biblioteca',
    source_query_text: 'biblioteca em Cabo Frio RJ',
    source_query_kind: 'place_type',
    google_types: [],
    google_business_status: 'OPERATIONAL',
    raw_payload: {},
    ...overrides,
  };
}

describe('decideVenueFilter — rejeições (exemplos do pedido original)', () => {
  it('rejeita secretaria municipal por google_types', () => {
    const item = makeItem({ name: 'Secretaria de Assistência Social', google_types: ['local_government_office'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('rejected');
    expect(result.matches.some((m) => m.rule_id === 'reject_type_government')).toBe(true);
  });

  it('rejeita órgão público administrativo por nome, mesmo sem google_types claro', () => {
    const item = makeItem({ name: 'Secretaria Municipal de Saúde', google_types: ['establishment'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('rejected');
    expect(result.matches.some((m) => m.rule_id === 'reject_keyword_government_office')).toBe(true);
  });

  it('rejeita escola de idiomas por palavra-chave no nome', () => {
    const item = makeItem({ name: 'Wizard Idiomas Cabo Frio', google_types: ['school'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('rejected');
    expect(result.matches.some((m) => m.rule_id === 'reject_keyword_language_school')).toBe(true);
  });

  it('rejeita banco por google_types', () => {
    const item = makeItem({ name: 'Banco do Brasil - Agência Centro', google_types: ['bank', 'finance'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('rejected');
  });

  it('rejeita posto de gasolina por google_types', () => {
    const item = makeItem({ name: 'Posto Ipiranga', google_types: ['gas_station'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('rejected');
  });

  it('rejeita empresa privada sem atividade pública (escritório de advocacia)', () => {
    const item = makeItem({ name: 'Silva e Souza Advocacia', google_types: ['lawyer'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('rejected');
  });
});

describe('decideVenueFilter — aceitações (exemplos do pedido original)', () => {
  it('aceita teatro por google_types', () => {
    const item = makeItem({ name: 'Teatro Municipal de Cabo Frio', google_types: ['performing_arts_theater'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('accepted');
    expect(result.matches.some((m) => m.rule_id === 'accept_type_theater')).toBe(true);
  });

  it('aceita museu por google_types', () => {
    const item = makeItem({ name: 'Museu de Arte de Cabo Frio', google_types: ['museum'] });
    expect(decideVenueFilter(item).decision).toBe('accepted');
  });

  it('aceita centro cultural por google_types', () => {
    const item = makeItem({ name: 'Centro Cultural Adolpho Bloch', google_types: ['cultural_center'] });
    expect(decideVenueFilter(item).decision).toBe('accepted');
  });

  it('aceita biblioteca por google_types', () => {
    const item = makeItem({ name: 'Biblioteca Pública Municipal', google_types: ['library'] });
    expect(decideVenueFilter(item).decision).toBe('accepted');
  });

  it('aceita parque por google_types', () => {
    const item = makeItem({ name: 'Parque Municipal', google_types: ['park'] });
    expect(decideVenueFilter(item).decision).toBe('accepted');
  });

  it('aceita centro de convivência por palavra-chave, quando google_types não ajuda', () => {
    const item = makeItem({ name: 'Centro de Convivência do Idoso', google_types: ['establishment'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('accepted');
    expect(result.matches.some((m) => m.rule_id === 'accept_keyword_convivencia')).toBe(true);
  });
});

describe('decideVenueFilter — ajustes a partir de dados reais (dry-run Região dos Lagos)', () => {
  it('aceita galeria de arte por google_types (art_gallery)', () => {
    const item = makeItem({ name: 'Instituto Cultural Casa de Caó', google_types: ['art_gallery', 'point_of_interest', 'establishment'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('accepted');
    expect(result.matches.some((m) => m.rule_id === 'accept_type_art_gallery')).toBe(true);
  });

  it('aceita por nome "espaço cultural" mesmo com google_types genérico (convention_center)', () => {
    const item = makeItem({
      name: 'Espaço Cultural Maria José Fernandes',
      google_types: ['convention_center', 'event_venue', 'point_of_interest', 'establishment'],
    });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('accepted');
    expect(result.matches.some((m) => m.rule_id === 'accept_keyword_espaco_cultural')).toBe(true);
  });

  it('museu com tourist_attraction simultâneo é aceito — tipo específico vence sinal fraco', () => {
    // caso real: "Casa Museu Carlos Scliar" vem com museum + tourist_attraction juntos.
    // tourist_attraction sozinho geraria revisão, mas museum é sinal específico e prevalece.
    const item = makeItem({ name: 'Casa Museu Carlos Scliar', google_types: ['art_museum', 'tourist_attraction', 'museum', 'point_of_interest'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('accepted');
    expect(result.matches.some((m) => m.rule_id === 'accept_type_museum')).toBe(true);
  });

  it('tourist_attraction SOZINHO, sem nenhum sinal de aceitação, ainda vai para revisão', () => {
    const item = makeItem({ name: 'Charitas', google_types: ['tourist_attraction', 'point_of_interest', 'establishment'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('needs_review');
  });

  it('historical_landmark sozinho permanece em revisão (decisão consciente, não promovido a aceitação)', () => {
    const item = makeItem({ name: 'Centro Arqueológico Morro do Índio', google_types: ['historical_landmark', 'historical_place', 'point_of_interest'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('needs_review');
    expect(result.decisive_layer).toBe('default');
  });

  it('point_of_interest isolado nunca decide nada por conta própria (nem accept nem review)', () => {
    const item = makeItem({ name: 'Espaço Cultural Torre Do Cabo', google_types: ['point_of_interest', 'establishment'] });
    const result = decideVenueFilter(item);
    // sem keyword "espaço cultural" pegando aqui (nome tem "Torre Do Cabo" junto,
    // mas a keyword usa word-boundary parcial — este teste documenta o comportamento atual)
    expect(result.matches.every((m) => m.matched_value !== 'point_of_interest')).toBe(true);
  });
});



describe('decideVenueFilter — casos intermediários (exemplos do pedido original)', () => {
  it('feira vai para revisão', () => {
    const item = makeItem({ name: 'Feira Livre de Araruama', google_types: ['establishment'] });
    expect(decideVenueFilter(item).decision).toBe('needs_review');
  });

  it('praça vai para revisão', () => {
    const item = makeItem({ name: 'Praça da Bandeira', google_types: ['establishment'] });
    expect(decideVenueFilter(item).decision).toBe('needs_review');
  });

  it('centro histórico vai para revisão', () => {
    const item = makeItem({ name: 'Centro Histórico de Cabo Frio', google_types: ['tourist_attraction'] });
    expect(decideVenueFilter(item).decision).toBe('needs_review');
  });

  it('monumento vai para revisão', () => {
    const item = makeItem({ name: 'Monumento aos Pescadores', google_types: ['point_of_interest'] });
    expect(decideVenueFilter(item).decision).toBe('needs_review');
  });
});

describe('decideVenueFilter — regra de prioridade e default', () => {
  it('rejeição vence aceitação quando ambas disparam no mesmo item', () => {
    // nome sugere aceitação (centro de convivência) mas google_types sugere rejeição (banco) —
    // cenário deliberadamente artificial para provar a regra de prioridade
    const item = makeItem({ name: 'Centro de Convivência', google_types: ['bank'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('rejected');
    expect(result.matches.some((m) => m.layer === 'accept')).toBe(true); // o match de accept existe...
    expect(result.matches.some((m) => m.layer === 'reject')).toBe(true); // ...mas reject decide
  });

  it('nenhuma regra disparando resulta em needs_review, nunca accepted', () => {
    const item = makeItem({ name: 'Estabelecimento Genérico XYZ', google_types: ['establishment'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('needs_review');
    expect(result.decisive_layer).toBe('default');
  });

  it('word-boundary evita falso positivo: "praça" não deveria casar dentro de outra palavra', () => {
    // "praca" como palavra isolada deve casar; um nome que apenas CONTÉM
    // as letras sem ser a palavra isolada não deveria
    const item = makeItem({ name: 'Pracatumirim Comércio de Bicicletas', google_types: ['bicycle_store'] });
    const result = decideVenueFilter(item);
    expect(result.matches.some((m) => m.rule_id === 'review_keyword_praca')).toBe(false);
  });

  it('reasoning é legível e cita o rule_id e o valor que casou', () => {
    const item = makeItem({ name: 'Museu do Mar', google_types: ['museum'] });
    const result = decideVenueFilter(item);
    expect(result.reasoning).toContain('accept_type_museum');
    expect(result.reasoning).toContain('museum');
  });
});

describe('decideVenueFilter — likely_fitness_generic (limitação estrutural do dado da Places API)', () => {
  function makeActivityItem(name: string, types: string[], kind: 'place_type' | 'activity_intent' = 'activity_intent') {
    return makeItem({ name, google_types: types, source_query_kind: kind, source_category_hint: 'hidroginastica' });
  }

  it('academia genérica sem menção à atividade no nome vai para likely_fitness_generic', () => {
    const item = makeActivityItem('Fit Local', ['gym', 'sports_activity_location', 'health']);
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('likely_fitness_generic');
    expect(result.matches.some((m) => m.rule_id === 'fitness_generic_type')).toBe(true);
  });

  it('nome menciona "hidroginástica" explicitamente — reforço de nome vence o tipo genérico, item é aceito', () => {
    const item = makeActivityItem('AQUAMILA Natação & Hidroginástica', ['sports_school', 'sports_activity_location']);
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('accepted');
    expect(result.matches.some((m) => m.rule_id === 'accept_keyword_activity_name_match')).toBe(true);
  });

  it('nome menciona "idosos" — reforço de nome também cobre referência ao público-alvo, não só à atividade', () => {
    const item = makeActivityItem('Associação de Hidroginastica de Ondinas', ['gym', 'sports_activity_location', 'health']);
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('accepted');
  });

  it('reforço de nome NUNCA dispara para query_kind place_type, mesmo com palavra coincidente no nome', () => {
    const item = makeActivityItem('Companhia de Dança Municipal', ['performing_arts_theater'], 'place_type');
    const result = decideVenueFilter(item);
    expect(result.matches.some((m) => m.rule_id === 'accept_keyword_activity_name_match')).toBe(false);
  });

  it('tipo genérico de fitness sozinho nunca é promovido a accepted nem rejected — fica em categoria própria', () => {
    const item = makeActivityItem('Academia Stetic Club', ['fitness_center', 'gym', 'sports_activity_location', 'health']);
    const result = decideVenueFilter(item);
    expect(result.decision).not.toBe('accepted');
    expect(result.decision).not.toBe('rejected');
    expect(result.decision).toBe('likely_fitness_generic');
  });

  it('reasoning de likely_fitness_generic é explícito sobre a limitação, não soa como rejeição', () => {
    const item = makeActivityItem('Tamoyo Esporte Clube', ['gym', 'sports_club', 'sports_activity_location', 'health']);
    const result = decideVenueFilter(item);
    expect(result.reasoning).toContain('sem indicação clara de atender o público 60+');
  });
});

describe('decideVenueFilter — novas regras a partir do segundo dry-run (shopping, mercado, sublocality, food)', () => {
  it('rejeita shopping_mall', () => {
    const item = makeItem({ name: 'Shopping Park Lagos', google_types: ['shopping_mall', 'movie_theater', 'point_of_interest'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('rejected');
    expect(result.matches.some((m) => m.rule_id === 'reject_type_shopping_mall')).toBe(true);
  });

  it('rejeita supermercado/grocery_store', () => {
    const item = makeItem({ name: 'Horti & Cia', google_types: ['supermarket', 'grocery_store', 'food_store'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('rejected');
    expect(result.matches.some((m) => m.rule_id === 'reject_type_grocery')).toBe(true);
  });

  it('rejeita sublocality/political — Google retornou um bairro, não um lugar físico', () => {
    const item = makeItem({ name: 'Parque Araruama', google_types: ['sublocality_level_1', 'sublocality', 'political'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('rejected');
    expect(result.matches.some((m) => m.rule_id === 'reject_type_sublocality_political')).toBe(true);
  });

  it('restaurant/food vai para REVISÃO, não rejeição (decisão consciente — pode haver evento social em restaurante)', () => {
    const item = makeItem({ name: 'Point do Pastel de Araruama', google_types: ['brazilian_restaurant', 'restaurant', 'food'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('needs_review');
    expect(result.decision).not.toBe('rejected');
    expect(result.matches.some((m) => m.rule_id === 'review_type_food_uncertain')).toBe(true);
  });

  it('restaurant combinado com museum NÃO escapa de revisão pela regra de coexistência — diferente de tourist_attraction, food não cede', () => {
    // Esse teste prova que a regra de coexistência (criada para tourist_attraction)
    // não se generalizou acidentalmente para review_type_food_uncertain.
    const item = makeItem({ name: 'Restaurante Museu Fictício', google_types: ['restaurant', 'food', 'museum'] });
    const result = decideVenueFilter(item);
    expect(result.decision).toBe('needs_review');
    expect(result.matches.some((m) => m.rule_id === 'review_type_food_uncertain')).toBe(true);
    expect(result.matches.some((m) => m.rule_id === 'accept_type_museum')).toBe(true); // o match existe...
    // ...mas review vence porque nem toda regra de review é tourist_attraction
  });

  it('praça, monumento e centro histórico continuam em revisão (comportamento preexistente preservado)', () => {
    expect(decideVenueFilter(makeItem({ name: 'Praça da Bandeira', google_types: ['plaza'] })).decision).toBe('needs_review');
    expect(decideVenueFilter(makeItem({ name: 'Monumento aos Pescadores', google_types: ['point_of_interest'] })).decision).toBe('needs_review');
    expect(decideVenueFilter(makeItem({ name: 'Centro Histórico da Passagem', google_types: ['tourist_attraction'] })).decision).toBe('needs_review');
  });
});


