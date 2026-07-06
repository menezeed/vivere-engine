/**
 * entity-resolution/interfaces/providers.ts
 *
 * ICandidateProvider — abstracção genérica de fornecimento de candidatos.
 *
 * PRINCÍPIO (ajuste #3 do roadmap aprovado):
 * O CandidateGenerator não deve conhecer apenas venues.
 * Hoje existe VenueCandidateProvider.
 * No futuro poderão existir:
 *   - PartnerCandidateProvider   (para resolver menções de parceiros)
 *   - EventCandidateProvider     (para resolver menções de eventos)
 *   - PlaceCandidateProvider     (genérico, sem acoplamento a staging)
 *
 * O CandidateGenerator recebe um ICandidateProvider e chama provide().
 * Não sabe o que está por baixo — não importa se é Supabase, uma API
 * externa, ou um ficheiro de fixtures para testes.
 *
 * Benefício imediato (MVP): facilita testes — o mock de candidatos é
 * apenas um ICandidateProvider com provide() que retorna dados sintéticos.
 */

import type { VenueCandidate, ActivityStagingId } from '../types/domain.js';
import type { CandidateSelectionConfig } from '../config/index.js';

// ── Interface genérica ────────────────────────────────────────────────────────

/**
 * Fornece candidatos para uma actividade a partir de uma fonte de dados.
 * Parametrizado pelo tipo de candidato para futura reutilização.
 *
 * T é o tipo de candidato (VenueCandidate por defeito no MVP).
 * O motor é tipado em VenueCandidate mas o contrato é genérico.
 */
export interface ICandidateProvider<T = VenueCandidate> {
  /**
   * Identificador do provider — usado em logs e métricas.
   * Ex: 'venue-staging-supabase', 'venue-fixture-test'
   */
  readonly id: string;

  /**
   * Retorna o pool bruto de candidatos elegíveis para a actividade.
   * A filtragem fina é responsabilidade do CandidatePreFilter — não deste método.
   * O provider deve retornar todos os candidatos que podem ser relevantes,
   * sem aplicar heurísticas de raio ou cidade.
   */
  provide(
    activityId:  ActivityStagingId,
    productKey:  string,
    config:      CandidateSelectionConfig,
  ): Promise<readonly T[]>;
}

// ── Implementação concreta — VenueCandidateProvider ───────────────────────────

/**
 * Contrato do provider de venues concreto.
 * Implementado na Sprint 7.4 usando IVenueResolutionCandidateRepository.
 *
 * Separar o provider do repositório permite:
 * 1. Testar o CandidateGenerator com qualquer provider mock
 * 2. Substituir a fonte de venues (ex: API externa, cache) sem alterar o motor
 * 3. Futuros providers de outras entidades (partners, events) seguem a mesma interface
 */
export interface IVenueCandidateProvider extends ICandidateProvider<VenueCandidate> {
  readonly id: 'venue-staging-supabase';
}
