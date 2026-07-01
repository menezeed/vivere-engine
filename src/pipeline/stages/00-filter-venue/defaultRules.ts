import type { KeywordRule, TypeRule } from './types';

/**
 * Identificadores das regras universais — union type formal, não
 * string solto, para que cada produto possa compor seu próprio
 * TRuleId como `UniversalVenueRuleId | <RuleId específico do produto>`
 * e manter tipagem forte sobre TODOS os matches que o motor pode
 * produzir, não só os específicos do produto.
 */
export type UniversalVenueRuleId =
  | 'reject_type_government'
  | 'reject_type_finance'
  | 'reject_type_fuel'
  | 'reject_type_education_admin'
  | 'reject_type_private_no_public_activity'
  | 'reject_type_shopping_mall'
  | 'reject_type_grocery'
  | 'reject_type_sublocality_political'
  | 'reject_keyword_language_school'
  | 'reject_keyword_driving_school'
  | 'reject_keyword_legal_office'
  | 'reject_keyword_government_office'
  | 'reject_keyword_bank_branch'
  | 'accept_type_theater'
  | 'accept_type_museum'
  | 'accept_type_cultural_center'
  | 'accept_type_library'
  | 'accept_type_park'
  | 'accept_type_art_gallery';

/**
 * Defaults UNIVERSAIS do motor — características gerais de lugar
 * físico, válidas para qualquer produto Vivere, não preferência de
 * público-alvo. Decisão registrada em ARCHITECTURE_EVOLUTION.md:
 * nenhum produto deveria precisar redigitar "rejeitar banco" ou
 * "aceitar museu" — isso é herdado, salvo override explícito.
 */

export const DEFAULT_REJECT_TYPE_RULES: TypeRule<UniversalVenueRuleId>[] = [
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

export const DEFAULT_REJECT_KEYWORD_RULES: KeywordRule<UniversalVenueRuleId>[] = [
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

export const DEFAULT_ACCEPT_TYPE_RULES: TypeRule<UniversalVenueRuleId>[] = [
  { rule_id: 'accept_type_theater', google_types: ['performing_arts_theater'] },
  { rule_id: 'accept_type_museum', google_types: ['museum'] },
  { rule_id: 'accept_type_cultural_center', google_types: ['cultural_center'] },
  { rule_id: 'accept_type_library', google_types: ['library'] },
  { rule_id: 'accept_type_park', google_types: ['park'] },
  { rule_id: 'accept_type_art_gallery', google_types: ['art_gallery'] },
];
