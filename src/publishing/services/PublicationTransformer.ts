/**
 * src/publishing/services/PublicationTransformer.ts
 *
 * Sprint 8.3 — Publishing Engine.
 *
 * Componente puro. Zero acesso a banco, zero chamadas a repositórios,
 * zero efeitos colaterais. Apenas transformação determinística entre:
 *
 *   PublishableVenue    → OperationalVenueInput
 *   PublishableActivity → OperationalActivityInput
 *
 * Mesma entrada + mesmo `publishedAt` injectado → sempre a mesma saída.
 * O Transformer nunca chama new Date(), Date.now() nem qualquer fonte de
 * tempo/aleatoriedade — ver ADR-0019 (Invariante 4, Publicação Determinística)
 * e a decisão da revisão arquitectural da Sprint 8.3 (Questão B).
 *
 * Mapeamento de campos: whitelist definitiva do ADR-0018. Qualquer campo
 * fora da whitelist (category, schedule, price, is_free, is_sponsored,
 * recurrence_*, interested_count, city) nunca é lido nem escrito aqui —
 * lista positiva, não lista negativa.
 *
 * Integração com os repositórios: NÃO é feita nesta sprint. Ver decisão
 * arquitectural da Sprint 8.3 (Questão C) — VenuePublisher/ActivityPublisher
 * (Sprint 8.4) actuam como Anti-Corruption Layer entre este componente e
 * IPublicVenueRepository/IPublicActivityRepository, que continuam a aceitar
 * PublishableVenue/PublishableActivity (contratos congelados da Sprint 8.2).
 */

import type {
  PublishableVenue,
  PublishableActivity,
  OperationalVenueInput,
  OperationalActivityInput,
} from '../types/domain.js';

export class PublicationTransformer {
  /**
   * PublishableVenue → OperationalVenueInput.
   *
   * @param venue        Venue lido de staging (venues_staging + raw_venue_items).
   * @param publishedAt  Timestamp a gravar em last_published_at — sempre injectado
   *                     pelo chamador (VenuePublisher, Sprint 8.4). O Transformer
   *                     nunca gera o seu próprio timestamp.
   */
  static transformVenue(venue: PublishableVenue, publishedAt: Date): OperationalVenueInput {
    return {
      name:              venue.name,
      address:           venue.address,
      lat:               venue.lat,
      lng:               venue.lng,
      phone:             venue.phone,
      website:           venue.website,
      // TODO(Sprint futura, quando existir spec canónica de formato):
      // Architecture Book v1.1 §5.1 pede TRANSFORM ("normalizar formato") para
      // opening_hours_raw → opening_hours. Decisão da revisão arquitectural da
      // Sprint 8.3 (Questão A): normalização fica fora do âmbito desta sprint.
      // COPY puro, sem qualquer transformação inventada.
      opening_hours:     venue.openingHoursRaw,
      image_url:         venue.imageUrl,
      engine_venue_id:   venue.stagingId,
      source_key:        venue.sourceKey,
      product_key:       venue.productKey,
      engine_status:     'active',
      last_published_at: publishedAt,
    };
  }

  /**
   * PublishableActivity → OperationalActivityInput.
   *
   * @param activity     Activity lida de staging (activities_staging + raw_activity_items),
   *                     já com resolvedPublicVenueId resolvido (pode ser null — proposed_new,
   *                     Architecture Book v1.1 §5.3).
   * @param publishedAt  Timestamp a gravar em last_published_at — sempre injectado
   *                     pelo chamador (ActivityPublisher, Sprint 8.4).
   */
  static transformActivity(activity: PublishableActivity, publishedAt: Date): OperationalActivityInput {
    return {
      title:              activity.title,
      description:        activity.description,
      start_date:         activity.startDate,
      end_date:           activity.endDate,
      // imagem_url (typo intencional) — ADR-0015: raw_activity_items.image_url →
      // public.activities.imagem_url. Typo não corrigido nesta fase.
      imagem_url:         activity.imageUrl,
      url:                activity.sourceUrl,
      phone:              activity.phone,
      // null permitido — activity com venue_resolution_status = proposed_new.
      venue_id:           activity.resolvedPublicVenueId,
      engine_activity_id: activity.stagingId,
      source_key:         activity.sourceKey,
      product_key:        activity.productKey,
      engine_status:      'active',
      last_published_at:  publishedAt,
    };
  }
}
