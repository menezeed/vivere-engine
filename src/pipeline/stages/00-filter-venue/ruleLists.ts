import type { VenueFilterRuleId } from './types';

/**
 * Listas de regras. Mantidas como dados simples (arrays/objetos),
 * não como funções — para serem fáceis de ler, ajustar e revisar
 * em code review sem precisar entender lógica de programação.
 *
 * Cada entrada de google_types usa os valores EXATOS retornados pelo
 * campo `types[]` da Places API (New). Cada entrada de keyword é
 * testada contra o nome do venue normalizado (minúsculo, sem acento)
 * usando "contém a palavra inteira", nunca substring livre — para
 * não rejeitar "Teatro Municipal" por engano ao buscar "Banco" e
 * achar dentro de "Bancada" (esse é só um exemplo do tipo de falso
 * positivo que a regra de word-boundary evita).
 */

interface TypeRule {
  rule_id: VenueFilterRuleId;
  google_types: string[];
}

interface KeywordRule {
  rule_id: VenueFilterRuleId;
  keywords: string[];
  matched_on: 'name' | 'website' | 'name_or_website';
}

// ---------- Camada 3c: reforço por nome quando a query era activity_intent ----------
// Aplicada SOMENTE a itens cuja source_query_kind é 'activity_intent'
// (hidroginástica, dança para idosos) — não faz sentido nessas keywords
// disparar em buscas de place_type, onde a regra teria outro significado.
// O sinal de nome aqui é mais forte que o google_types genérico do
// Google para academias/estúdios, porque o Google não distingue uma
// academia comum de uma que de fato oferece a atividade buscada.
export const ACTIVITY_NAME_REINFORCEMENT_KEYWORDS: string[] = [
  'hidroginastica', 'hidroginástica',
  'natacao', 'natação',
  'danca', 'dança',
  'terceira idade', 'idosos', 'idoso',
  'aquatica', 'aquática', 'aquafit', 'aqua',
];

// ---------- Camada 5: tipo genérico de fitness, sem reforço de nome ----------
// Tipos retornados em massa pelas buscas de hidroginástica/dança no
// dry-run real — descrevem "lugar de exercício físico" de forma
// genérica, sem nenhuma informação sobre o público atendido. Isso é
// uma limitação do DADO da Places API, não algo resolvível com mais
// regras de tipo: o Google não tem um tipo "atividade para idosos".
export const FITNESS_GENERIC_TYPE_RULE = {
  rule_id: 'fitness_generic_type' as const,
  google_types: [
    'gym', 'fitness_center', 'sports_activity_location', 'sports_club',
    'sports_school', 'sports_complex', 'health', 'yoga_studio',
  ],
};

// ---------- Camada 1: rejeição por google_types ----------
export const REJECT_TYPE_RULES: TypeRule[] = [
  {
    rule_id: 'reject_type_government',
    google_types: ['local_government_office', 'city_hall', 'courthouse'],
  },
  {
    rule_id: 'reject_type_finance',
    google_types: ['bank', 'atm', 'finance'],
  },
  {
    rule_id: 'reject_type_fuel',
    google_types: ['gas_station', 'car_repair', 'car_wash'],
  },
  {
    rule_id: 'reject_type_education_admin',
    // escolas regulares e universidades — não são o público-alvo do produto;
    // escolas de idiomas são pegas por palavra-chave (camada 2), pois o
    // Google às vezes as tipa como 'school' genérico sem distinguir
    google_types: ['primary_school', 'secondary_school', 'university'],
  },
  {
    rule_id: 'reject_type_private_no_public_activity',
    // estabelecimentos privados que não têm relação com atividade aberta ao público
    google_types: ['real_estate_agency', 'insurance_agency', 'accounting', 'lawyer', 'dentist', 'doctor'],
  },
  {
    rule_id: 'reject_type_shopping_mall',
    // visto em massa no dry-run real ("Shopping Park Lagos", "Open Mall
    // Araruama", "Shopping Araruama") — comércio, não venue de atividade
    google_types: ['shopping_mall'],
  },
  {
    rule_id: 'reject_type_grocery',
    google_types: ['supermarket', 'grocery_store', 'food_store'],
  },
  {
    rule_id: 'reject_type_sublocality_political',
    // visto no dry-run real ("Parque Araruama" tipado como sublocality —
    // o Google retornou o BAIRRO, não um lugar físico visitável
    google_types: ['sublocality', 'sublocality_level_1', 'political', 'administrative_area_level_1', 'administrative_area_level_2'],
  },
];

// ---------- Camada 2: rejeição por palavra-chave no nome ----------
export const REJECT_KEYWORD_RULES: KeywordRule[] = [
  {
    rule_id: 'reject_keyword_language_school',
    keywords: ['escola de idiomas', 'curso de ingles', 'curso de inglês', 'wizard', 'wise up', 'cna idiomas', 'fisk'],
    matched_on: 'name',
  },
  {
    rule_id: 'reject_keyword_driving_school',
    keywords: ['autoescola', 'auto escola', 'cfc '],
    matched_on: 'name',
  },
  {
    rule_id: 'reject_keyword_legal_office',
    keywords: ['advocacia', 'advogados', 'escritorio de advocacia'],
    matched_on: 'name',
  },
  {
    rule_id: 'reject_keyword_government_office',
    keywords: ['secretaria municipal', 'secretaria de estado', 'prefeitura de', 'camara municipal', 'cartorio', 'cartório'],
    matched_on: 'name',
  },
  {
    rule_id: 'reject_keyword_bank_branch',
    keywords: ['banco do brasil', 'caixa economica', 'caixa econômica', 'bradesco', 'itau', 'itaú', 'santander'],
    matched_on: 'name',
  },
];

// ---------- Camada 3: aceitação por google_types ----------
export const ACCEPT_TYPE_RULES: TypeRule[] = [
  { rule_id: 'accept_type_theater', google_types: ['performing_arts_theater'] },
  { rule_id: 'accept_type_museum', google_types: ['museum'] },
  { rule_id: 'accept_type_cultural_center', google_types: ['cultural_center'] },
  { rule_id: 'accept_type_library', google_types: ['library'] },
  { rule_id: 'accept_type_park', google_types: ['park'] },
  { rule_id: 'accept_type_art_gallery', google_types: ['art_gallery'] },
];

// ---------- Camada 3b: aceitação por palavra-chave ----------
// Usada quando o google_types não tem um tipo específico (ex: "centro de
// convivência" não é um tipo nativo do Google — geralmente vem tipado
// como 'establishment' genérico, então o nome é o sinal mais confiável)
export const ACCEPT_KEYWORD_RULES: KeywordRule[] = [
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
];

// ---------- Camada 4: casos intermediários — sempre revisão ----------
export const REVIEW_KEYWORD_RULES: KeywordRule[] = [
  { rule_id: 'review_keyword_feira', keywords: ['feira de', 'feira livre', 'feira municipal'], matched_on: 'name' },
  { rule_id: 'review_keyword_praca', keywords: ['praca ', 'praça '], matched_on: 'name' },
  { rule_id: 'review_keyword_centro_historico', keywords: ['centro historico', 'centro histórico'], matched_on: 'name' },
  { rule_id: 'review_keyword_monumento', keywords: ['monumento', 'memorial'], matched_on: 'name' },
];

export const REVIEW_TYPE_RULES: TypeRule[] = [
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
];
