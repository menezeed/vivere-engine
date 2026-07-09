/**
 * src/publishing/repositories/factory.ts
 * Ponto único de montagem do IPublishingRepositorySet.
 * Mesmo padrão do EntityResolutionRepositoryFactory.
 */

import type { IPublishingRepositorySet } from './interfaces.js';
import { PublishableVenueRepository }    from './impl/PublishableVenueRepository.js';
import { PublishableActivityRepository } from './impl/PublishableActivityRepository.js';
import { PublicVenueRepository }         from './impl/PublicVenueRepository.js';
import { PublicActivityRepository }      from './impl/PublicActivityRepository.js';
import { PublicationRunRepository }      from './impl/PublicationRunRepository.js';
import { PublicationEventRepository }    from './impl/PublicationEventRepository.js';

export class PublishingRepositoryFactory {
  static async forSupabase(): Promise<IPublishingRepositorySet> {
    const { getSupabaseClient } = await import('../../persistence/client/supabase.js');
    const db = getSupabaseClient();

    return {
      publishableVenue:    new PublishableVenueRepository(db),
      publishableActivity: new PublishableActivityRepository(db),
      publicVenue:         new PublicVenueRepository(db),
      publicActivity:      new PublicActivityRepository(db),
      run:                 new PublicationRunRepository(db),
      event:               new PublicationEventRepository(db),
    };
  }

  static fromObject(repos: IPublishingRepositorySet): IPublishingRepositorySet {
    return repos;
  }
}
