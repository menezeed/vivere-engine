import type { RawVenueItem } from '../../../types/RawVenueItem';
import type { VenueFilterRuleMatch } from './types';
import {
  REJECT_TYPE_RULES,
  REJECT_KEYWORD_RULES,
  ACCEPT_TYPE_RULES,
  ACCEPT_KEYWORD_RULES,
  REVIEW_KEYWORD_RULES,
  REVIEW_TYPE_RULES,
  ACTIVITY_NAME_REINFORCEMENT_KEYWORDS,
  FITNESS_GENERIC_TYPE_RULE,
} from './ruleLists';

/**
 * Normalização de texto para comparação de palavra-chave — minúsculo,
 * sem acento. Reaproveita o mesmo princípio de normalizeTitle usado
 * no resto do VAIP (dedupe, categoria), mas implementado localmente
 * aqui para manter este módulo sem dependências externas, já que é
 * o primeiro estágio do pipeline a rodar e deve ser o mais simples
 * e auto-contido possível.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * "Contém a palavra inteira", não substring livre — evita falsos
 * positivos como "banco" casando dentro de "bancada de jardim".
 * Usa espaço/início/fim de string como delimitador.
 */
function containsKeyword(haystack: string, keyword: string): boolean {
  const normalizedHaystack = normalize(haystack);
  const normalizedKeyword = normalize(keyword.trim());
  const pattern = new RegExp(`(^|\\s)${escapeRegex(normalizedKeyword)}(\\s|$)`, 'i');
  return pattern.test(normalizedHaystack);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function evaluateTypeRules(
  item: RawVenueItem,
  rules: Array<{ rule_id: VenueFilterRuleMatch['rule_id']; google_types: string[] }>,
  layer: VenueFilterRuleMatch['layer'],
): VenueFilterRuleMatch[] {
  const matches: VenueFilterRuleMatch[] = [];
  for (const rule of rules) {
    const hit = rule.google_types.find((t) => item.google_types.includes(t));
    if (hit) {
      matches.push({
        rule_id: rule.rule_id,
        layer,
        matched_on: 'google_types',
        matched_value: hit,
      });
    }
  }
  return matches;
}

function evaluateKeywordRules(
  item: RawVenueItem,
  rules: Array<{
    rule_id: VenueFilterRuleMatch['rule_id'];
    keywords: string[];
    matched_on: 'name' | 'website' | 'name_or_website';
  }>,
  layer: VenueFilterRuleMatch['layer'],
): VenueFilterRuleMatch[] {
  const matches: VenueFilterRuleMatch[] = [];

  for (const rule of rules) {
    const targets: Array<{ field: 'name' | 'website'; value: string | null }> =
      rule.matched_on === 'name_or_website'
        ? [
            { field: 'name', value: item.name },
            { field: 'website', value: item.website },
          ]
        : [{ field: rule.matched_on, value: rule.matched_on === 'name' ? item.name : item.website }];

    for (const target of targets) {
      if (!target.value) continue;
      const hit = rule.keywords.find((kw) => containsKeyword(target.value as string, kw));
      if (hit) {
        matches.push({
          rule_id: rule.rule_id,
          layer,
          matched_on: target.field,
          matched_value: hit,
        });
        break; // uma keyword já encontrada para esta regra é suficiente, não duplica o mesmo rule_id
      }
    }
  }

  return matches;
}

/**
 * Camada 3c — reforço de nome para itens activity_intent. SOMENTE
 * aplicada quando source_query_kind === 'activity_intent' — em buscas
 * de place_type (teatro, museu, etc.) essas palavras não têm o mesmo
 * significado e não devem disparar nada.
 */
function evaluateActivityNameReinforcement(item: RawVenueItem): VenueFilterRuleMatch[] {
  if (item.source_query_kind !== 'activity_intent') return [];
  if (!item.name) return [];

  const hit = ACTIVITY_NAME_REINFORCEMENT_KEYWORDS.find((kw) => containsKeyword(item.name, kw));
  if (!hit) return [];

  return [
    {
      rule_id: 'accept_keyword_activity_name_match',
      layer: 'accept',
      matched_on: 'name',
      matched_value: hit,
    },
  ];
}

/**
 * Camada 5 — fitness genérico. Só dispara se NENHUM reforço de nome
 * (camada 3c) já tiver casado — o reforço de nome é o sinal mais forte
 * e, se presente, a aceitação prevalece sem precisar marcar como
 * "fitness genérico" também.
 */
function evaluateFitnessGeneric(item: RawVenueItem, alreadyHasNameReinforcement: boolean): VenueFilterRuleMatch[] {
  if (alreadyHasNameReinforcement) return [];
  const hit = FITNESS_GENERIC_TYPE_RULE.google_types.find((t) => item.google_types.includes(t));
  if (!hit) return [];

  return [
    {
      rule_id: FITNESS_GENERIC_TYPE_RULE.rule_id,
      layer: 'fitness_generic',
      matched_on: 'google_types',
      matched_value: hit,
    },
  ];
}

/**
 * Avalia TODAS as camadas sobre o item — nunca para na primeira regra
 * que casar. Retorna o conjunto completo de matches; a decisão final
 * (qual layer vence) é responsabilidade de decideVenueFilter, não
 * desta função.
 */
export function evaluateAllRules(item: RawVenueItem): VenueFilterRuleMatch[] {
  const nameReinforcement = evaluateActivityNameReinforcement(item);

  return [
    ...evaluateTypeRules(item, REJECT_TYPE_RULES, 'reject'),
    ...evaluateKeywordRules(item, REJECT_KEYWORD_RULES, 'reject'),
    ...evaluateTypeRules(item, ACCEPT_TYPE_RULES, 'accept'),
    ...evaluateKeywordRules(item, ACCEPT_KEYWORD_RULES, 'accept'),
    ...nameReinforcement,
    ...evaluateKeywordRules(item, REVIEW_KEYWORD_RULES, 'review'),
    ...evaluateTypeRules(item, REVIEW_TYPE_RULES, 'review'),
    ...evaluateFitnessGeneric(item, nameReinforcement.length > 0),
  ];
}
