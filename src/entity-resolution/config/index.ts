/**
 * entity-resolution/config/index.ts
 *
 * Configuração imutável do Entity Resolution Engine.
 *
 * Três tipos de configuração, todos injectáveis e com defaults:
 *   CandidateSelectionConfig — o que entra no pipeline (ADR-0012)
 *   ScoringConfig            — como os scores são calculados (ADR-0011)
 *   ThresholdConfig          — como os resultados são classificados (ADR-0011)
 *
 * PRINCÍPIO (ADR-0005, ADR-0011, ADR-0012):
 * Defaults universais + override por produto/região.
 * Nada hardcoded nos componentes do pipeline.
 *
 * EntityResolutionConfig agrega os três — o orquestrador recebe um
 * único objecto de configuração e distribui para cada componente.
 */

import { MatcherConfigurationError, ConfigurationError } from '../errors/index.js';

// ── CandidateSelectionConfig ─────────────────────────────────────────────────

export interface CandidateSelectionConfig {
  /** Número máximo de candidatos após PreFilter. Default: 50. */
  readonly maxCandidates: number;

  /** Raio máximo em metros para inclusão de candidatos. Default: 5000. */
  readonly maxRadiusMeters: number;

  /**
   * Permitir candidatos de cidades diferentes da actividade.
   * Default: false — venues de outra cidade raramente são o match correcto.
   */
  readonly allowCrossCity: boolean;

  /**
   * Status permitidos no pool de candidatos.
   * Default: ['approved', 'promoted'] — nunca pending_review (ADR-0011).
   */
  readonly allowedVenueStatuses: ReadonlyArray<'approved' | 'promoted'>;

  /**
   * Priorizar candidatos com categoria compatível no ranking do PreFilter.
   * Não descarta — reordena. Default: true.
   */
  readonly categoryBoost: boolean;
}

export const DEFAULT_CANDIDATE_SELECTION: Readonly<CandidateSelectionConfig> = {
  maxCandidates:        50,
  maxRadiusMeters:      5000,
  allowCrossCity:       false,
  allowedVenueStatuses: ['approved', 'promoted'],
  categoryBoost:        true,
} as const;

// ── ScoringConfig ─────────────────────────────────────────────────────────────

export interface ScoringWeights {
  /** Peso do NameMatcher no score híbrido. Default: 0.50. */
  readonly name:    number;
  /** Peso do GeoMatcher no score híbrido. Default: 0.35. */
  readonly geo:     number;
  /** Peso do AddressMatcher no score híbrido. Default: 0.15. */
  readonly address: number;
}

export interface ConfidenceBoost {
  /** Boost quando confidence_hint = 'explicit_name'. Default: +0.10. */
  readonly explicit_name:          number;
  /** Boost quando confidence_hint = 'inferred_from_context'. Default: 0.00. */
  readonly inferred_from_context:  number;
  /** Boost quando confidence_hint = 'ambiguous'. Default: -0.10. */
  readonly ambiguous:              number;
}

export interface ScoringConfig {
  readonly weights:         ScoringWeights;
  readonly confidenceBoost: ConfidenceBoost;
}

export const DEFAULT_SCORING: Readonly<ScoringConfig> = {
  weights: {
    name:    0.50,
    geo:     0.35,
    address: 0.15,
  },
  confidenceBoost: {
    explicit_name:         +0.10,
    inferred_from_context:  0.00,
    ambiguous:             -0.10,
  },
} as const;

// ── ThresholdConfig ────────────────────────────────────────────────────────────

export interface ThresholdConfig {
  /**
   * Score mínimo para classificar como 'matched'.
   * Default: 0.85 — conservador intencional (calibrar com dados reais).
   */
  readonly highConfidence: number;

  /**
   * Score mínimo para incluir como sugestão.
   * Abaixo disto → proposed_new (sem sugestão útil).
   * Default: 0.50.
   */
  readonly minSuggestion: number;
}

export const DEFAULT_THRESHOLDS: Readonly<ThresholdConfig> = {
  highConfidence: 0.85,
  minSuggestion:  0.50,
} as const;

// ── EntityResolutionConfig (agregado) ────────────────────────────────────────

/** Configuração completa do motor — injectada no EntityResolutionEngine. */
export interface EntityResolutionConfig {
  readonly selection:  CandidateSelectionConfig;
  readonly scoring:    ScoringConfig;
  readonly thresholds: ThresholdConfig;
}

/** Configuração com todos os defaults — usar quando não há override. */
export const DEFAULT_ER_CONFIG: Readonly<EntityResolutionConfig> = {
  selection:  DEFAULT_CANDIDATE_SELECTION,
  scoring:    DEFAULT_SCORING,
  thresholds: DEFAULT_THRESHOLDS,
} as const;

// ── Validação ─────────────────────────────────────────────────────────────────

/**
 * Valida que a configuração é internamente consistente.
 * Lança MatcherConfigurationError para qualquer violação.
 * Chamar no startup — falha ruidosa intencional.
 */
export function validateERConfig(config: EntityResolutionConfig): void {
  const { selection, scoring, thresholds } = config;

  // Pesos devem somar 1.0 (tolerância de floating point)
  const weightSum = scoring.weights.name + scoring.weights.geo + scoring.weights.address;
  if (Math.abs(weightSum - 1.0) > 0.001) {
    throw new MatcherConfigurationError(
      'ScoringConfig',
      'weights',
      scoring.weights,
      `Pesos devem somar 1.0 — soma actual: ${weightSum.toFixed(3)}`,
    );
  }

  // Todos os pesos devem ser [0, 1]
  for (const [key, val] of Object.entries(scoring.weights)) {
    if (val < 0 || val > 1) {
      throw new MatcherConfigurationError('ScoringConfig', `weights.${key}`, val, 'Deve estar em [0, 1]');
    }
  }

  // Thresholds devem estar em [0, 1] e highConfidence > minSuggestion
  if (thresholds.highConfidence < 0 || thresholds.highConfidence > 1) {
    throw new MatcherConfigurationError('ThresholdConfig', 'highConfidence', thresholds.highConfidence, 'Deve estar em [0, 1]');
  }
  if (thresholds.minSuggestion < 0 || thresholds.minSuggestion > 1) {
    throw new MatcherConfigurationError('ThresholdConfig', 'minSuggestion', thresholds.minSuggestion, 'Deve estar em [0, 1]');
  }
  if (thresholds.highConfidence <= thresholds.minSuggestion) {
    throw new MatcherConfigurationError(
      'ThresholdConfig',
      'highConfidence',
      thresholds.highConfidence,
      `highConfidence (${thresholds.highConfidence}) deve ser maior que minSuggestion (${thresholds.minSuggestion})`,
    );
  }

  // maxCandidates deve ser positivo
  if (selection.maxCandidates < 1) {
    throw new MatcherConfigurationError('CandidateSelectionConfig', 'maxCandidates', selection.maxCandidates, 'Deve ser ≥ 1');
  }

  // maxRadiusMeters deve ser positivo
  if (selection.maxRadiusMeters < 1) {
    throw new MatcherConfigurationError('CandidateSelectionConfig', 'maxRadiusMeters', selection.maxRadiusMeters, 'Deve ser ≥ 1m');
  }

  // Pool não pode estar vazio
  if (selection.allowedVenueStatuses.length === 0) {
    throw new ConfigurationError(
      'CandidateSelectionConfig.allowedVenueStatuses não pode ser vazio — inclua pelo menos approved ou promoted',
    );
  }
}
