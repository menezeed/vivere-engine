/**
 * Propostas automáticas de elegibilidade 60+ para fontes novas (piloto UK).
 *
 * Reutiliza as classes e o formato de registo da Issue #62
 * (EligibilityRecord). Diferença essencial: isto é uma PROPOSTA. Cada
 * registo leva uma nota em human_review_notes, e nada aqui é carregado
 * pela Review API: só entra no dataset auditado depois de revisão humana
 * (nova versão do ficheiro, como na Issue #62).
 *
 * Critérios (os mesmos do relatório da Issue #60):
 * - confirmed_60plus: o texto DA ACTIVIDADE refere explicitamente pessoas
 *   mais velhas / 60+. Evidência da organização não basta.
 * - likely_suitable: organização dirigida a pessoas mais velhas, sem
 *   referência de idade na actividade.
 * - unclear: faltam dados, ou é um serviço e não uma actividade.
 * - unsuitable: não é actividade ou é dirigida a outro público.
 */
import type { EligibilityRecord } from './eligibilityAudit';
import { normalizeVenueName } from '../../publishing/services/duplicateDetection';

export const PROPOSAL_NOTE = 'Proposta automática (piloto UK, fontes novas): requer revisão humana antes de entrar no dataset auditado.';

export interface ProposalInput {
  source_item_id: string;
  source_url: string | null;
  title: string;
  kind: 'group' | 'event';
  categories: string[];
  organisation_evidence: string;
  membership_required: boolean | null;
  explicit_older: string | null;
  audience_snippets: string[];
  booking: 'booking_essential' | 'booking_advisable' | 'drop_in' | null;
  spaces_limited: boolean;
  price_text: string | null;
  physical_hint: boolean;
  has_location: boolean;
  generic_venue: boolean;
  schedule_complete: boolean;
}

/** Serviços (transporte, compras, apoio individual), não actividades de lazer. */
export const SERVICE = /\b(shopping bus|transport|befriending|lifts?|home visits?|advice clinic|benefits? (advice|clinic)|telephone friendship)\b/i;
/** Público principal não é o 60+. */
const OTHER_AUDIENCE = /\b(children only|for (children|kids|toddlers|teenagers|students)|under[- ]?(18|16|12)s?|parent and baby)\b/i;

/**
 * Público restrito a uma condição (demência, perda de memória, AVC…) e
 * cuidadores. Pode servir pessoas mais velhas, mas não é aberto ao
 * público 60+ em geral: fica unclear (decisão de âmbito), nunca
 * likely_suitable automático.
 */
/**
 * Só um limiar de 60 ou mais confirma 60+ (Codex r0, achado 4): "older
 * people", "over 55s", "retired" ou "seniors" ficam em likely_suitable.
 */
export const EXPLICIT_60PLUS = /\b(over[- ]?(60|65|70)s?|aged (60|65|70)\s?(\+|and over|or over)|anyone over (60|65|70))\b|\b(60|65|70)\s?\+/i;

export const RESTRICTED_AUDIENCE =/\b(dementia|memory loss|alzheimer'?s|living with (a )?stroke|parkinson'?s)\b/i;

export function proposeEligibility(p: ProposalInput): EligibilityRecord {
  const text = [p.title, ...p.categories].join(' ');
  let classification: EligibilityRecord['classification'];
  let confidence: EligibilityRecord['confidence'];
  let evidence: string;
  const notes = [PROPOSAL_NOTE];

  if (OTHER_AUDIENCE.test([text, ...p.audience_snippets].join(' '))) {
    classification = 'unsuitable'; confidence = 'medium';
    evidence = 'O texto da actividade indica outro público principal.';
  } else if (RESTRICTED_AUDIENCE.test(p.audience_snippets.join(' '))) {
    classification = 'unclear'; confidence = 'medium';
    evidence = 'A fonte dirige a actividade a um público restrito (ex.: pessoas com demência ou perda de memória e cuidadores), não ao público 60+ em geral. Decisão de âmbito para o PO.';
  } else if (SERVICE.test(text)) {
    classification = 'unclear'; confidence = 'medium';
    evidence = 'Parece um serviço de apoio (ex.: transporte ou compras), não uma actividade de lazer. Decisão de âmbito para o PO.';
  } else if (p.explicit_older && EXPLICIT_60PLUS.test(p.explicit_older)) {
    classification = 'confirmed_60plus'; confidence = 'medium'; // automático: nunca "high" sem revisão
    evidence = `O texto da actividade refere explicitamente 60+: "${p.explicit_older}"`;
  } else if (p.explicit_older) {
    // "older people", "over 55s", "retired"…: público mais velho, mas sem limiar 60+.
    classification = 'likely_suitable'; confidence = 'medium';
    evidence = `A actividade refere pessoas mais velhas sem limiar 60+ ("${p.explicit_older}"); não confirma 60+.`;
  } else if (!p.has_location && !p.schedule_complete) {
    classification = 'unclear'; confidence = 'low';
    evidence = 'Faltam local e horário completos na fonte; não dá para avaliar.';
  } else {
    classification = 'likely_suitable'; confidence = 'medium';
    evidence = `${p.organisation_evidence} A actividade não refere idade.`;
  }
  if (p.audience_snippets.length && classification !== 'confirmed_60plus') {
    notes.push(`Público referido na fonte: ${p.audience_snippets.map(s => `"${s}"`).join(' ')}`);
  }

  const availability: EligibilityRecord['availability'] = p.booking === 'drop_in' ? 'open' : 'unknown';
  const recommendation =
    classification === 'unsuitable' ? 'Fora de publicação.'
    : classification === 'unclear' ? 'Manter em pending_review; decisão de âmbito ou dados em falta.'
    : 'Manter em pending_review até revisão humana da proposta.';

  return {
    source_item_id: p.source_item_id,
    source_url: p.source_url ?? '',
    title: p.title,
    kind: p.kind,
    classification,
    confidence,
    evidence,
    eligibility_type: classification === 'unsuitable' ? 'not_applicable' : 'unknown',
    membership_required: p.membership_required === true ? true : null,
    availability,
    additional_costs: p.price_text,
    physical_activity: p.physical_hint,
    distances_cited: [],
    levels_cited: [],
    access_notes: null,
    schedule_complete_in_source: p.schedule_complete,
    generic_venue: p.generic_venue,
    recommendation: recommendation + (p.booking === 'booking_essential' ? ' Reserva obrigatória.' : '')
      + (p.spaces_limited ? ' Vagas limitadas.' : ''),
    human_review_notes: notes,
  };
}

// ── Possíveis duplicados entre fontes (só relatório; decisão humana) ────────

export interface DuplicateCandidate {
  title: string;
  source_key: string;
  source_item_id: string;
}

export interface CrossSourceDuplicate {
  candidate: DuplicateCandidate;
  existing: DuplicateCandidate;
  reason: 'same_normalized_title' | 'similar_title';
  similarity: number;
}

function tokens(s: string): Set<string> {
  const STOP = new Set(['the', 'and', 'for', 'a', 'of', 'in', 'at', 'with', 'to', 'group', 'club']);
  return new Set(normalizeVenueName(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(t => t.length > 2 && !STOP.has(t)));
}

export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter(t => tb.has(t)).length;
  return inter / new Set([...ta, ...tb]).size;
}

/**
 * Compara as actividades novas com as existentes (outras fontes) pelo nome
 * normalizado (mesma normalização de duplicateDetection.ts) e por
 * semelhança de palavras. Não junta nada: só reporta.
 */
export function crossSourceDuplicates(
  candidates: DuplicateCandidate[], existing: DuplicateCandidate[], threshold = 0.6,
): CrossSourceDuplicate[] {
  const out: CrossSourceDuplicate[] = [];
  for (const c of candidates) {
    for (const e of existing) {
      if (c.source_key === e.source_key) continue;
      if (normalizeVenueName(c.title) === normalizeVenueName(e.title)) {
        out.push({ candidate: c, existing: e, reason: 'same_normalized_title', similarity: 1 });
        continue;
      }
      const sim = titleSimilarity(c.title, e.title);
      if (sim >= threshold) out.push({ candidate: c, existing: e, reason: 'similar_title', similarity: Math.round(sim * 100) / 100 });
    }
  }
  return out;
}
