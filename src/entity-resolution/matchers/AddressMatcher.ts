/**
 * entity-resolution/matchers/AddressMatcher.ts
 *
 * Implementação do IAddressMatcher — matching por similaridade de endereço.
 *
 * PRINCÍPIOS:
 * — Complementar ao NameMatcher — nunca decisivo sozinho.
 * — Score máximo: 0.70 (reserva espaço para Name e Geo no hybrid).
 * — Retorna null quando a menção não contém texto de endereço.
 * — Usa TextNormalizer para normalização (mesmo pipeline do NameMatcher).
 *
 * QUANDO É ÚTIL:
 *   — Fonte editorial inclui endereço explícito: "Rua das Begônias, 169"
 *   — O texto da menção menciona elementos de endereço reconhecíveis
 *
 * QUANDO RETORNA null:
 *   — VenueMention.raw_address_text é null ou vazio
 *   — Candidato sem address
 *
 * SCORE MÁXIMO 0.70:
 *   Fontes editoriais raramente fornecem endereços exactos. Um endereço
 *   parcial ou aproximado não deve dominar o hybrid score. O AddressMatcher
 *   serve como desempate quando Name e Geo são insuficientes.
 */

import type { IAddressMatcher } from '../interfaces/index.js';
import type { MatchScore, VenueCandidate } from '../types/domain.js';
import type { VenueMention } from '../../types/RawActivityItem.js';
import type { NormalizeOptions } from '../utils/text.js';
import {
  normalize,
  normalizeAndTokenize,
  trigramSimilarity,
  jaccardSimilarity,
  STOPWORDS_PT_BR,
} from '../utils/text.js';

// ── Configuração ──────────────────────────────────────────────────────────────

export interface AddressMatcherConfig {
  normalize?: NormalizeOptions;
  /** Score máximo que o AddressMatcher pode produzir. Default: 0.70. */
  maxScore?: number;
  /** Threshold mínimo de trigrama para considerar. Default: 0.15. */
  trigramThreshold?: number;
}

const DEFAULT_ADDRESS_MATCHER_CONFIG: Required<AddressMatcherConfig> = {
  normalize:        { removeStopwords: true, stopwords: STOPWORDS_PT_BR },
  maxScore:         0.70,
  trigramThreshold: 0.15,
};

// ── AddressMatcher ────────────────────────────────────────────────────────────

export class AddressMatcher implements IAddressMatcher {
  readonly id = 'address' as const;

  private readonly cfg: Required<AddressMatcherConfig>;

  constructor(config: AddressMatcherConfig = {}) {
    this.cfg = { ...DEFAULT_ADDRESS_MATCHER_CONFIG, ...config };
  }

  /**
   * Calcula score de similaridade de endereço.
   * Retorna null se a menção não tiver raw_address_text ou o candidato
   * não tiver address — não há nada a comparar.
   */
  score(mention: VenueMention, candidate: VenueCandidate): MatchScore | null {
    try {
      const mentionAddr   = mention.raw_address_text;
      const candidateAddr = candidate.address;

      // Sem endereço em qualquer lado — não aplicável
      if (!mentionAddr || !candidateAddr) return null;
      if (mentionAddr.trim().length === 0)   return null;
      if (candidateAddr.trim().length === 0) return null;

      const normMention   = normalize(mentionAddr,   this.cfg.normalize);
      const normCandidate = normalize(candidateAddr, this.cfg.normalize);

      if (!normMention || !normCandidate) return null;

      // Tentar exact match normalizado
      if (normMention === normCandidate) {
        return this.makeScore(
          this.cfg.maxScore,
          'exact',
          `Endereço exact match: "${mentionAddr}"`,
        );
      }

      // Contains match
      if (normCandidate.includes(normMention) || normMention.includes(normCandidate)) {
        const shorter = normMention.length < normCandidate.length ? normMention : normCandidate;
        const longer  = normMention.length < normCandidate.length ? normCandidate : normMention;
        const pct = shorter.length / longer.length;
        const score = this.cfg.maxScore * (0.55 + pct * 0.35);
        return this.makeScore(
          score,
          'contains',
          `Endereço contains match (cobertura ${(pct * 100).toFixed(0)}%)`,
        );
      }

      // Token overlap (Jaccard) — útil para endereços parciais
      const tokensM = normalizeAndTokenize(normMention,   { removeStopwords: false });
      const tokensC = normalizeAndTokenize(normCandidate, { removeStopwords: false });
      const jac = jaccardSimilarity(tokensM, tokensC);

      if (jac >= 0.25) {
        return this.makeScore(
          jac * this.cfg.maxScore * 0.85,
          'token_overlap',
          `Jaccard de endereço=${jac.toFixed(3)}`,
        );
      }

      // Trigram — captura ruas com nomes parecidos ou abreviados
      const trig = trigramSimilarity(normMention, normCandidate);
      if (trig >= this.cfg.trigramThreshold) {
        return this.makeScore(
          trig * this.cfg.maxScore * 0.70,
          'trigram',
          `Trigram similarity de endereço=${trig.toFixed(3)}`,
        );
      }

      // Sem similaridade suficiente
      return null;

    } catch {
      return null;
    }
  }

  private makeScore(value: number, subMethod: string, detail: string): MatchScore {
    return {
      value:     Math.max(0, Math.min(this.cfg.maxScore, value)),
      method:    'address',
      subMethod,
      detail,
    };
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createAddressMatcher(config?: AddressMatcherConfig): AddressMatcher {
  return new AddressMatcher(config);
}
