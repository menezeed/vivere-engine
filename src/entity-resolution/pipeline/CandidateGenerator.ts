/**
 * entity-resolution/pipeline/CandidateGenerator.ts
 *
 * Implementação do ICandidateGenerator.
 *
 * RESPONSABILIDADE ÚNICA:
 * Consultar o pool bruto de candidatos elegíveis via ICandidateProvider.
 * Não filtra. Não calcula scores. Não conhece thresholds.
 * Devolve todos os candidatos disponíveis — o PreFilter decide o que fica.
 *
 * DESIGN:
 * Recebe um ICandidateProvider<VenueCandidate> — não conhece Supabase
 * directamente. O provider concreto (VenueCandidateProvider) é montado
 * pelo EntityResolutionEngine e injectado aqui.
 * Em testes, qualquer provider mock funciona.
 *
 * Level 2, 2026-09-26 — trustedCityContext acrescentado: repassado
 * directamente para ResolutionContext e para o CandidatePool
 * devolvido. Este componente NÃO usa o valor para filtrar nada —
 * só o transporta, tal como já fazia com venueMention/productKey.
 */

import type { ICandidateGenerator } from '../interfaces/index.js';
import type { ICandidateProvider, ResolutionContext } from '../interfaces/providers.js';
import type {
  CandidatePool,
  ActivityStagingId,
  VenueCandidate,
  TrustedCityContext,
} from '../types/domain.js';
import type { VenueMention } from '../../types/RawActivityItem.js';
import type { CandidateSelectionConfig } from '../config/index.js';
import { CandidateGenerationError } from '../errors/index.js';

export class CandidateGenerator implements ICandidateGenerator {
  constructor(
    private readonly provider: ICandidateProvider<VenueCandidate>,
  ) {}

  async generate(
    activityId:         ActivityStagingId,
    mention:            VenueMention | null,
    productKey:         string,
    config:             CandidateSelectionConfig,
    trustedCityContext: TrustedCityContext | null = null,
  ): Promise<CandidatePool> {
    const context: ResolutionContext = { activityId, productKey, config, trustedCityContext };

    try {
      const candidates = await this.provider.provide(context);

      return {
        activityId,
        venueMention:  mention,
        productKey,
        candidates,
        generatedAt:   Date.now(),
        trustedCityContext,
      };

    } catch (err) {
      throw new CandidateGenerationError(activityId, err);
    }
  }
}
