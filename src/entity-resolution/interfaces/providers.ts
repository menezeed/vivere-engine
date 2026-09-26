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

import type { ActivityStagingId, TrustedCityContext } from '../types/domain.js';
import type { CandidateSelectionConfig } from '../config/index.js';

// ── Contexto de resolução — o que o provider recebe ──────────────────────

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

  /**
   * Level 2, 2026-09-26 — contexto territorial confiável da Activity
   * (derivado da fonte, nunca do candidate pool nem do texto da
   * menção). null quando a fonte não declara este contexto.
   */
  readonly trustedCityContext?: TrustedCityContext | null;
}

// ── Interface genérica ────────────────────────────────────────────────

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

// ── IVenueCandidateProvider — especialização para o MVP ──────────────────

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

// ── ISourceTerritorialContextProvider — Level 2, 2026-09-26 ──────────────

/**
 * Resolve o contexto territorial confiável de uma fonte (source_key),
 * sem que o EntityResolutionEngine precise de conhecer nenhuma
 * configuração concreta de collector (ex: CABO_FRIO_CONFIG).
 *
 * Genérico deliberadamente: a implementação concreta hoje consulta o
 * registry WordPress (WordPressSourceTerritorialContextProvider), mas
 * a interface não menciona WordPress, collectors, nem qualquer
 * detalhe de implementação — futuras fontes (Google Places, outras)
 * podem implementar a mesma interface sem mudar o contrato.
 *
 * Nunca lança — source_key desconhecido ou sem contexto declarado
 * devolve null, nunca inventa nem infere.
 */
export interface ISourceTerritorialContextProvider {
  readonly id: string;
  getCityContext(sourceKey: string): TrustedCityContext | null;
}

/**
 * Provider nulo — devolve sempre null, para nenhum source_key.
 * Default do construtor do EntityResolutionEngine, para preservar
 * compatibilidade com chamadores existentes que não injectam
 * explicitamente um provider real (ex: código antigo, testes que não
 * exercitam contexto territorial). Comportamento equivalente ao
 * pipeline antes desta mudança: nenhum contexto territorial confiável
 * disponível, CandidatePreFilter nunca aplica filtro de cidade.
 */
export const NULL_TERRITORIAL_CONTEXT_PROVIDER: ISourceTerritorialContextProvider = {
  id: 'null-territorial-context-provider',
  getCityContext: () => null,
};
