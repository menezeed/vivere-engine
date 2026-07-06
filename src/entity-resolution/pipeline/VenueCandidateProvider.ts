/**
 * entity-resolution/pipeline/VenueCandidateProvider.ts
 *
 * Implementação concreta de IVenueCandidateProvider.
 *
 * Consulta staging.venues_staging via IVenueResolutionCandidateRepository
 * e mapeia para VenueCandidate. É a ponte entre o repositório e o Generator.
 *
 * Segue CandidateSelectionConfig.allowedVenueStatuses (ADR-0011, Decisão 4):
 * nunca retorna venues com status pending_review.
 */

import type { IVenueCandidateProvider, ResolutionContext } from '../interfaces/providers.js';
import type { IVenueResolutionCandidateRepository } from '../repositories/interfaces.js';
import type { VenueCandidate } from '../types/domain.js';

export class VenueCandidateProvider implements IVenueCandidateProvider {
  readonly id = 'venue-staging-supabase';

  constructor(
    private readonly candidateRepo: IVenueResolutionCandidateRepository,
  ) {}

  async provide(context: ResolutionContext): Promise<readonly VenueCandidate[]> {
    const rows = await this.candidateRepo.findEligibleVenues(
      context.productKey,
      context.config.allowedVenueStatuses,
    );

    return rows.map(r => ({
      id:                   r.id,
      product_key:          context.productKey,
      name:                 r.name,
      address:              r.address,
      city:                 r.city,
      lat:                  r.lat,
      lng:                  r.lng,
      google_types:         r.google_types,
      source_category_hint: r.source_category_hint,
      proposal_status:      r.proposal_status,
    }));
  }
}
