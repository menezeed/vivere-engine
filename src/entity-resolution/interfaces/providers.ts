/**
 * entity-resolution/interfaces/providers.ts
 *
 * ICandidateProvider<T> — abstracção genérica de fornecimento de candidatos.
 *
 * PRINCÍPIO (ajuste #1): a interface não pressupõe que o candidato é um venue.
 * Expõe apenas o comportamento necessário: dado um contexto de resolução,
 * retornar uma lista de candidatos do tipo T.
 *
 * A interface é intencionalmente minimalista — o provider sabe apenas
 * como encontrar candidatos. Não sabe como avaliá-los (responsabilidade
 * dos Matchers) nem como filtrar heuristicamente (responsabilidade do PreFilter).
 *
 * Hoje: VenueCandidateProvider → retorna VenueCandidate[]
 * Futuro sem alteração de contrato:
 *   PartnerCandidateProvider → retorna PartnerCandidate[]
 *   EventCandidateProvider   → retorna EventCandidate[]
 *   PlaceCandidateProvider   → retorna PlaceCandidate[]
 */

import type { ActivityStagingId } from '../types/domain.js';
import type { CandidateSelectionConfig } from '../config/index.js';

// ── Contexto de resolução — o que o provider recebe ──────────────────────────

/**
 * Contexto mínimo que o provider precisa para encontrar candidatos.
 * Propositalmente agnóstico de tipo de entidade.
 */
export interface ResolutionContext {
  /** A actividade cuja menção está a ser resolvida. */
  readonly activityId:  ActivityStagingId;

  /** Produto — dimensão de particionamento (ADR-0004). */
  readonly productKey:  string;

  /** Configuração de selecção — limita o pool retornado. */
  readonly config:      CandidateSelectionConfig;
}

// ── Interface genérica ────────────────────────────────────────────────────────

/**
 * Fornece candidatos a partir de uma fonte de dados.
 *
 * T = tipo de candidato. No MVP: VenueCandidate.
 * A interface não menciona "venue", "staging" ou qualquer detalhe de persistência.
 *
 * O provider retorna o pool bruto — sem filtros de raio ou cidade.
 * O CandidatePreFilter aplica essas heurísticas depois.
 *
 * Nunca lança — encapsula erros e propaga via Promise rejected com ERError.
 */
export interface ICandidateProvider<T> {
  /** Identificador — usado em logs e métricas. */
  readonly id: string;

  /** Fornece os candidatos elegíveis para o contexto dado. */
  provide(context: ResolutionContext): Promise<readonly T[]>;
}

// ── IVenueCandidateProvider — especialização para o MVP ──────────────────────

/**
 * Provider de venues a partir de staging.venues_staging.
 * Implementado na Sprint 7.4 com IVenueResolutionCandidateRepository.
 *
 * Separar o provider do repositório garante que:
 * 1. O CandidateGenerator é testável com qualquer ICandidateProvider mock
 * 2. A fonte de dados pode mudar (cache, API externa) sem alterar o motor
 * 3. O padrão estende-se a futuras entidades sem alterar o contrato base
 */

import type { VenueCandidate } from '../types/domain.js';

export interface IVenueCandidateProvider extends ICandidateProvider<VenueCandidate> {
  readonly id: string; // ex: 'venue-staging-supabase', 'venue-fixture-test'
}
