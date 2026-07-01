import type { RawVenueItem } from '../../../types/RawVenueItem';
import { evaluateAllRules } from './ruleEngine';
import type { VenueFilterResult, VenueFilterRuleMatch } from './types';
import type { ResolvedRuleSet } from './resolveRuleSet';

/**
 * Regra de prioridade entre camadas, quando mais de uma dispara:
 *   reject > review > accept > ambiguity_fallback
 *
 * Justificativa: na dúvida entre incluir algo que não deveria e
 * excluir algo que deveria, prefira excluir (ou, na falta de sinal
 * de rejeição, mandar para revisão) e deixar a inclusão para decisão
 * humana. Isso é a mesma postura conservadora usada em todos os
 * outros estágios do pipeline — nunca "inventar" uma admissão duvidosa.
 *
 * Se NENHUMA regra disparar, o default é 'needs_review', nunca
 * 'accepted' — um lugar desconhecido para o filtro não deveria
 * avançar automaticamente para o estágio de categoria.
 *
 * GENERALIZAÇÃO: este motor não conhece nenhum produto. O ruleSet
 * (já resolvido com defaults universais + config do produto) é
 * recebido como parâmetro, e os generics TRuleId/TAmbiguityLabel
 * propagam o vocabulário real de cada produto sem o motor precisar
 * conhecê-lo (ver ARCHITECTURE_EVOLUTION.md).
 */
export function decideVenueFilter<TRuleId extends string, TAmbiguityLabel extends string>(
  item: RawVenueItem,
  ruleSet: ResolvedRuleSet<TRuleId, TAmbiguityLabel>,
): VenueFilterResult<TRuleId, TAmbiguityLabel> {
  const matches = evaluateAllRules(item, ruleSet);

  const rejectMatches = matches.filter((m) => m.layer === 'reject');
  const reviewMatches = matches.filter((m) => m.layer === 'review');
  const acceptMatches = matches.filter((m) => m.layer === 'accept');

  if (rejectMatches.length > 0) {
    return {
      decision: 'rejected',
      matches,
      decisive_layer: 'reject',
      reasoning: buildReasoning('Rejeitado', rejectMatches),
    };
  }

  // Regra de coexistência: rule_id de revisão declarados como "sinal
  // fraco" pelo produto (ruleSet.weak_review_rule_ids) não deveriam
  // "afogar" uma aceitação clara e específica já presente. Revisão só
  // vence quando é o ÚNICO tipo de sinal presente, ou quando o sinal
  // de revisão NÃO está na lista de fracos do produto (esses continuam
  // fortes o suficiente para forçar revisão mesmo com tipo aceito).
  const weakIds = new Set<TRuleId>(ruleSet.weak_review_rule_ids);
  const reviewIsOnlyWeakType =
    reviewMatches.length > 0 &&
    reviewMatches.every((m) => weakIds.has(m.rule_id)) &&
    acceptMatches.length > 0;

  if (reviewMatches.length > 0 && !reviewIsOnlyWeakType) {
    return {
      decision: 'needs_review',
      matches,
      decisive_layer: 'review',
      reasoning: buildReasoning('Caso intermediário, requer revisão', reviewMatches),
    };
  }

  if (acceptMatches.length > 0) {
    return {
      decision: 'accepted',
      matches,
      decisive_layer: 'accept',
      reasoning: buildReasoning('Aceito', acceptMatches),
    };
  }

  if (reviewMatches.length > 0) {
    // chegou aqui só pode ser o caso reviewIsOnlyWeakType, mas sem
    // accept de fato disponível (não deveria ocorrer, mantido por segurança)
    return {
      decision: 'needs_review',
      matches,
      decisive_layer: 'review',
      reasoning: buildReasoning('Caso intermediário, requer revisão', reviewMatches),
    };
  }

  // Fallback de ambiguidade do produto (ex: "fitness genérico" no
  // Vivere 60+). Só chega aqui se não houve reject, review nem accept
  // (o reforço de nome, quando presente, já entrou em acceptMatches e
  // o item teria sido aceito acima). Isso é uma SUBCATEGORIA de
  // revisão, não uma rejeição — a decisão final ainda é humana. O
  // label e a frase de motivo vêm do ruleSet do produto, nunca de um
  // literal fixo no motor.
  const ambiguityMatches = matches.filter((m) => m.layer === 'ambiguity_fallback');
  if (ambiguityMatches.length > 0) {
    return {
      decision: ruleSet.ambiguity_fallback.label,
      matches,
      decisive_layer: 'ambiguity_fallback',
      reasoning: buildReasoning(ruleSet.ambiguity_fallback.display_reason, ambiguityMatches),
    };
  }

  return {
    decision: 'needs_review',
    matches: [],
    decisive_layer: 'default',
    reasoning: 'Nenhuma regra heurística reconheceu este local — enviado para revisão por padrão de segurança.',
  };
}

function buildReasoning<TRuleId extends string>(prefix: string, matches: VenueFilterRuleMatch<TRuleId>[]): string {
  const parts = matches.map((m) => {
    const fieldLabel = m.matched_on === 'google_types' ? 'tipo' : m.matched_on === 'name' ? 'nome' : 'website';
    return `${m.rule_id} (${fieldLabel}: "${m.matched_value}")`;
  });
  return `${prefix} por: ${parts.join('; ')}`;
}
