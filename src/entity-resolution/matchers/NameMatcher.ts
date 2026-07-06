/**
 * entity-resolution/matchers/NameMatcher.ts
 *
 * Implementação do INameMatcher — matching por similaridade de nome.
 *
 * PRINCÍPIOS:
 * — Função pura: mesma entrada, mesma saída. Sempre.
 * — Zero acesso a banco, rede, ficheiros ou estado global.
 * — Cada sub-método é aplicado em cascata; o melhor score vence.
 * — Score sempre em [0.0, 1.0].
 * — MatchScore.detail é legível por humanos — explica o porquê.
 *
 * HIERARQUIA de sub-métodos (do mais forte ao mais fraco):
 *   1. Exact Match        → 1.00  (normalização idêntica)
 *   2. Contains Match     → 0.80  (um contém o outro)
 *   3. Token Overlap      → 0.30–0.75  (Jaccard sobre tokens)
 *   4. Trigram Similarity → 0.00–0.70  (similaridade de caracteres)
 *
 * O NameMatcher retorna o melhor score encontrado entre os 4 sub-métodos.
 * Nunca retorna null — há sempre uma tentativa de comparação de texto.
 * Retorna score=0 com detail explicativo quando nenhum método encontra similaridade.
 */

import type { INameMatcher } from '../interfaces/index.js';
import type { MatchScore, VenueCandidate } from '../types/domain.js';
import type { VenueMention } from '../../types/RawActivityItem.js';
import type { NormalizeOptions } from '../utils/text.js';
import {
  normalize,
  normalizeAndTokenize,
  trigramSimilarity,
  jaccardSimilarity,
  STOPWORDS_PT_BR,
  STOPWORDS_EN_GB,
} from '../utils/text.js';

// ── Configuração do NameMatcher ───────────────────────────────────────────────

export interface NameMatcherConfig {
  /** Opções de normalização — idioma e stopwords. */
  normalize?: NormalizeOptions;

  /** Score mínimo de trigrama para considerar. Default: 0.20. */
  trigramThreshold?: number;

  /** Score mínimo de Jaccard para considerar. Default: 0.20. */
  jaccardThreshold?: number;
}

export const DEFAULT_NAME_MATCHER_CONFIG: Required<NameMatcherConfig> = {
  normalize:         { removeStopwords: true, stopwords: STOPWORDS_PT_BR },
  trigramThreshold:  0.20,
  jaccardThreshold:  0.20,
};

// ── Scores por sub-método ─────────────────────────────────────────────────────

const SCORES = {
  EXACT:             1.00,
  CONTAINS:          0.80,
  JACCARD_MAX:       0.75,  // score máximo por Jaccard (reserva espaço para Contains)
  TRIGRAM_MAX:       0.70,  // score máximo por Trigram (abaixo do Contains)
} as const;

// ── NameMatcher ───────────────────────────────────────────────────────────────

export class NameMatcher implements INameMatcher {
  readonly id = 'name' as const;

  private readonly cfg: Required<NameMatcherConfig>;

  constructor(config: NameMatcherConfig = {}) {
    this.cfg = { ...DEFAULT_NAME_MATCHER_CONFIG, ...config };
  }

  /**
   * Calcula o score de similaridade de nome entre uma menção e um candidato.
   * Aplica os 4 sub-métodos em cascata e retorna o melhor resultado.
   * Nunca lança — erros internos retornam score 0.
   */
  score(mention: VenueMention, candidate: VenueCandidate): MatchScore {
    try {
      const mentionText   = mention.raw_text;
      const candidateName = candidate.name;

      if (!mentionText || !candidateName) {
        return this.makeScore(0, 'no_text', 'Texto de menção ou nome do candidato vazio');
      }

      const normMention   = normalize(mentionText,   this.cfg.normalize);
      const normCandidate = normalize(candidateName, this.cfg.normalize);

      // Sub-método 1 — Exact Match
      const exact = this.tryExact(normMention, normCandidate);
      if (exact) return exact;

      // Sub-método 2 — Contains Match
      const contains = this.tryContains(normMention, normCandidate, mentionText, candidateName);
      if (contains && contains.value >= SCORES.CONTAINS) return contains;

      // Sub-método 3 — Token Overlap (Jaccard)
      const jaccard = this.tryJaccard(normMention, normCandidate);

      // Sub-método 4 — Trigram Similarity
      const trigram = this.tryTrigram(normMention, normCandidate);

      // Retornar o melhor entre Contains (parcial), Jaccard e Trigram
      const candidates = [contains, jaccard, trigram].filter((s): s is MatchScore => s !== null);
      if (candidates.length === 0) {
        return this.makeScore(0, 'no_match', `Sem similaridade encontrada entre "${mentionText}" e "${candidateName}"`);
      }

      return candidates.reduce((best, curr) => curr.value > best.value ? curr : best);

    } catch {
      return this.makeScore(0, 'error', 'Erro interno no NameMatcher');
    }
  }

  // ── Sub-métodos privados ────────────────────────────────────────────────────

  private tryExact(normMention: string, normCandidate: string): MatchScore | null {
    if (normMention === normCandidate) {
      return this.makeScore(
        SCORES.EXACT,
        'exact',
        `Exact match normalizado: "${normMention}"`,
      );
    }
    return null;
  }

  private tryContains(
    normMention:   string,
    normCandidate: string,
    rawMention:    string,
    rawCandidate:  string,
  ): MatchScore | null {
    // Candidato contido na menção: "Praia do Forte" ∈ "Canto do Forte, na Praia do Forte"
    if (normMention.includes(normCandidate)) {
      const pct = normCandidate.length / normMention.length;
      // Score proporcional ao quanto o candidato cobre a menção
      const score = Math.min(SCORES.CONTAINS, SCORES.CONTAINS * (0.6 + pct * 0.4));
      return this.makeScore(
        score,
        'contains',
        `Candidato "${rawCandidate}" contido na menção "${rawMention}"`,
      );
    }
    // Menção contida no candidato: "Museu José de Dome" ∈ "Museu e Casa de Cultura José de Dome"
    if (normCandidate.includes(normMention)) {
      const pct = normMention.length / normCandidate.length;
      const score = Math.min(SCORES.CONTAINS, SCORES.CONTAINS * (0.5 + pct * 0.5));
      return this.makeScore(
        score,
        'contains',
        `Menção "${rawMention}" contida no candidato "${rawCandidate}"`,
      );
    }
    return null;
  }

  private tryJaccard(normMention: string, normCandidate: string): MatchScore | null {
    const tokensM = normalizeAndTokenize(normMention,   { removeStopwords: false });
    const tokensC = normalizeAndTokenize(normCandidate, { removeStopwords: false });

    const jac = jaccardSimilarity(tokensM, tokensC);

    if (jac < this.cfg.jaccardThreshold) return null;

    // Escalar para [0, JACCARD_MAX]
    const score = jac * SCORES.JACCARD_MAX;
    return this.makeScore(
      score,
      'token_overlap',
      `Jaccard=${jac.toFixed(3)} (tokens: [${tokensM.join(',')}] vs [${tokensC.join(',')}])`,
    );
  }

  private tryTrigram(normMention: string, normCandidate: string): MatchScore | null {
    const sim = trigramSimilarity(normMention, normCandidate);

    if (sim < this.cfg.trigramThreshold) return null;

    // Escalar para [0, TRIGRAM_MAX]
    const score = sim * SCORES.TRIGRAM_MAX;
    return this.makeScore(
      score,
      'trigram',
      `Trigram similarity=${sim.toFixed(3)}`,
    );
  }

  private makeScore(value: number, subMethod: string, detail: string): MatchScore {
    return {
      value:     Math.max(0, Math.min(1, value)),  // clip [0,1] por segurança
      method:    'name',
      subMethod,
      detail,
    };
  }
}

// ── Factory de conveniência ───────────────────────────────────────────────────

/** Cria um NameMatcher com configuração pt-BR (default). */
export function createNameMatcher(config?: NameMatcherConfig): NameMatcher {
  return new NameMatcher(config);
}

/** Cria um NameMatcher com configuração en-GB. */
export function createNameMatcherEnGB(config?: Omit<NameMatcherConfig, 'normalize'>): NameMatcher {
  return new NameMatcher({
    ...config,
    normalize: { removeStopwords: true, stopwords: STOPWORDS_EN_GB },
  });
}
