import type { RawVenueItem } from '../../../types/RawVenueItem';
import { evaluateAllRules } from './ruleEngine';
import type { VenueFilterResult } from './types';

/**
 * Regra de prioridade entre camadas, quando mais de uma dispara:
 *   reject > review > accept
 *
 * Justificativa: na dúvida entre incluir algo que não deveria e
 * excluir algo que deveria, prefira excluir (ou, na falta de sinal
 * de rejeição, mandar para revisão) e deixar a inclusão para decisão
 * humana. Isso é a mesma postura conservadora usada em todos os
 * outros estágios do pipeline (recorrência, categoria, venue
 * resolution) — nunca "inventar" uma admissão duvidosa.
 *
 * Se NENHUMA regra disparar, o default é 'needs_review', nunca
 * 'accepted' — um lugar desconhecido para o filtro não deveria
 * avançar automaticamente para o estágio de categoria.
 */
export function decideVenueFilter(item: RawVenueItem): VenueFilterResult {
  const matches = evaluateAllRules(item);

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

  // Regra de coexistência: tourist_attraction e os demais sinais de
  // "caso intermediário" são tratados como sinal FRACO. Quando o item
  // já carrega um sinal de aceitação claro e específico (museum,
  // cultural_center, library, etc.), esse sinal específico prevalece
  // — tourist_attraction é apenas um tipo genérico de turismo que o
  // Google atribui em paralelo a quase qualquer marco/atração, e não
  // deveria "afogar" uma classificação já específica e confiável.
  // Revisão só vence quando é o ÚNICO tipo de sinal presente, ou
  // quando o sinal de revisão vem de palavra-chave (esses continuam
  // fortes o suficiente para forçar revisão mesmo com tipo aceito —
  // ex: um nome com "centro histórico" pode ser relevante mas merece
  // checagem humana mesmo que o Google também tenha tipado como museu).
  const reviewIsOnlyWeakType =
    reviewMatches.length > 0 &&
    reviewMatches.every((m) => m.rule_id === 'review_type_tourist_attraction') &&
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

  // Camada 5 — fitness genérico. Só chega aqui se não houve reject,
  // review nem accept (o reforço de nome, quando presente, já entrou
  // em acceptMatches e o item teria sido aceito acima). Isso é uma
  // SUBCATEGORIA de revisão, não uma rejeição: o local provavelmente
  // é uma academia/estúdio comum, sem indicação clara de atender o
  // público 60+, mas a decisão final ainda é humana.
  const fitnessGenericMatches = matches.filter((m) => m.layer === 'fitness_generic');
  if (fitnessGenericMatches.length > 0) {
    return {
      decision: 'likely_fitness_generic',
      matches,
      decisive_layer: 'fitness_generic',
      reasoning: buildReasoning(
        'Provável academia/estúdio genérico, sem indicação clara de atender o público 60+',
        fitnessGenericMatches,
      ),
    };
  }

  return {
    decision: 'needs_review',
    matches: [],
    decisive_layer: 'default',
    reasoning: 'Nenhuma regra heurística reconheceu este local — enviado para revisão por padrão de segurança.',
  };
}

function buildReasoning(prefix: string, matches: VenueFilterResult['matches']): string {
  const parts = matches.map((m) => {
    const fieldLabel = m.matched_on === 'google_types' ? 'tipo' : m.matched_on === 'name' ? 'nome' : 'website';
    return `${m.rule_id} (${fieldLabel}: "${m.matched_value}")`;
  });
  return `${prefix} por: ${parts.join('; ')}`;
}
