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
 */

import type { ICandidateGenerator } from '../interfaces/index.js';
import type { ICandidateProvider, ResolutionContext } from '../interfaces/providers.js';
import type {
  CandidatePool,
  ActivityStagingId,
  VenueCandidate,
} from '../types/domain.js';
import type { VenueMention } from '../../types/RawActivityItem.js';
import type { CandidateSelectionConfig } from '../config/index.js';
import { CandidateGenerationError } from '../errors/index.js';

export class CandidateGenerator implements ICandidateGenerator {
  constructor(
    private readonly provider: ICandidateProvider<VenueCandidate>,
  ) {}

  async generate(
    activityId:  ActivityStagingId,
    mention:     VenueMention | null,
    productKey:  string,
    config:      CandidateSelectionConfig,
  ): Promise<CandidatePool> {
    const context: ResolutionContext = { activityId, productKey, config };

    try {
      const candidates = await this.provider.provide(context);

      return {
        activityId,
        venueMention:  mention,
        productKey,
        candidates,
        generatedAt:   Date.now(),
      };

    } catch (err) {
      throw new CandidateGenerationError(activityId, err);
    }
  }
}
