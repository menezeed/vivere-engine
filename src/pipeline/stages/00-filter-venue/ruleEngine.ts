import type { RawVenueItem } from '../../../types/RawVenueItem';
import type { VenueFilterRuleMatch, TypeRule, KeywordRule } from './types';
import type { ResolvedRuleSet } from './resolveRuleSet';

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

function evaluateTypeRules<TRuleId extends string>(
  item: RawVenueItem,
  rules: TypeRule<TRuleId>[],
  layer: VenueFilterRuleMatch['layer'],
): VenueFilterRuleMatch<TRuleId>[] {
  const matches: VenueFilterRuleMatch<TRuleId>[] = [];
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

function evaluateKeywordRules<TRuleId extends string>(
  item: RawVenueItem,
  rules: KeywordRule<TRuleId>[],
  layer: VenueFilterRuleMatch['layer'],
): VenueFilterRuleMatch<TRuleId>[] {
  const matches: VenueFilterRuleMatch<TRuleId>[] = [];

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
 * Camada de reforço por nome para itens activity_intent. SOMENTE
 * aplicada quando source_query_kind === 'activity_intent' — em buscas
 * de place_type (teatro, museu, etc.) essas palavras não têm o mesmo
 * significado e não devem disparar nada. As keywords em si vêm do
 * ruleSet do produto (activity_name_reinforcement_keywords) — o
 * motor não conhece nenhum vocabulário de público-alvo.
 */
function evaluateActivityNameReinforcement<TRuleId extends string>(
  item: RawVenueItem,
  keywords: string[],
  reinforcementRuleId: TRuleId,
): VenueFilterRuleMatch<TRuleId>[] {
  if (item.source_query_kind !== 'activity_intent') return [];
  if (!item.name) return [];

  const hit = keywords.find((kw) => containsKeyword(item.name, kw));
  if (!hit) return [];

  return [
    {
      rule_id: reinforcementRuleId,
      layer: 'accept',
      matched_on: 'name',
      matched_value: hit,
    },
  ];
}

/**
 * Camada de fallback de ambiguidade (ex: "fitness genérico" no Vivere
 * 60+). Só dispara se NENHUM reforço de nome já tiver casado — o
 * reforço de nome é o sinal mais forte e, se presente, a aceitação
 * prevalece sem precisar marcar como ambíguo também. A regra em si
 * (quais google_types disparam, qual rule_id usar) vem do ruleSet do
 * produto — o motor não conhece nenhum valor real.
 */
function evaluateAmbiguityFallback<TRuleId extends string>(
  item: RawVenueItem,
  fallback: { rule_id: TRuleId; google_types: string[] },
  alreadyHasNameReinforcement: boolean,
): VenueFilterRuleMatch<TRuleId>[] {
  if (alreadyHasNameReinforcement) return [];
  const hit = fallback.google_types.find((t) => item.google_types.includes(t));
  if (!hit) return [];

  return [
    {
      rule_id: fallback.rule_id,
      layer: 'ambiguity_fallback',
      matched_on: 'google_types',
      matched_value: hit,
    },
  ];
}

/**
 * Avalia TODAS as camadas sobre o item, usando o ruleSet já resolvido
 * (defaults universais + config do produto) — nunca para na primeira
 * regra que casar. Retorna o conjunto completo de matches; a decisão
 * final (qual layer vence) é responsabilidade de decideVenueFilter,
 * não desta função.
 */
export function evaluateAllRules<TRuleId extends string, TAmbiguityLabel extends string>(
  item: RawVenueItem,
  ruleSet: ResolvedRuleSet<TRuleId, TAmbiguityLabel>,
): VenueFilterRuleMatch<TRuleId>[] {
  const nameReinforcement = evaluateActivityNameReinforcement(
    item,
    ruleSet.activity_name_reinforcement_keywords,
    ruleSet.activity_name_reinforcement_rule_id,
  );

  return [
    ...evaluateTypeRules(item, ruleSet.reject_type, 'reject'),
    ...evaluateKeywordRules(item, ruleSet.reject_keyword, 'reject'),
    ...evaluateTypeRules(item, ruleSet.accept_type, 'accept'),
    ...evaluateKeywordRules(item, ruleSet.accept_keyword, 'accept'),
    ...nameReinforcement,
    ...evaluateKeywordRules(item, ruleSet.review_keyword, 'review'),
    ...evaluateTypeRules(item, ruleSet.review_type, 'review'),
    ...evaluateAmbiguityFallback(item, ruleSet.ambiguity_fallback, nameReinforcement.length > 0),
  ];
}
