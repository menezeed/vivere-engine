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
 * Mesma entrada + mesmo `publishedAt`/`asOf` injectados → sempre a mesma saída.
 * O Transformer nunca chama new Date(), Date.now() nem qualquer fonte de
 * tempo/aleatoriedade — ver ADR-0019 (Invariante 4, Publicação Determinística),
 * a decisão da revisão arquitectural da Sprint 8.3 (Questão B), e ADR-0020
 * (Sprint 8.7 — política de ocorrência futura para activities).
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
 *
 * CORRECÇÃO (Level 3, 2026-09-23) — Stable Source Activity Identity.
 * engine_activity_id deixou de ser activity.stagingId (efémero — novo a
 * cada ingestion_run, ver ADR sobre raw_activity_items append-only) e
 * passou a ser deriveEngineActivityId(activity.sourceKey,
 * activity.sourceItemId) — determinístico, estável entre execuções para a
 * mesma activity real. Backfill Safety Audit (2026-09-23) confirmou 0 de
 * 48 public.activities com engine_activity_id não-nulo — sem dados
 * existentes a reconciliar, mudança limpa antes da primeira publicação
 * real da Engine.
 */

import type {
  PublishableVenue,
  PublishableActivity,
  OperationalVenueInput,
  OperationalActivityInput,
} from '../types/domain.js';
import { selectNextOccurrence, occurrenceToDateRange } from './occurrenceSelection.js';
import { deriveEngineActivityId } from './activityIdentity.js';

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
   * PublishableActivity → OperationalActivityInput, ou null se não existir
   * nenhuma ocorrência futura (ADR-0020) — activity efectivamente expirada.
   * O chamador (ActivityPublisher) decide a acção sobre null: nunca inserir
   * (se nunca publicada) ou arquivar (se já publicada). O Transformer não
   * toma essa decisão de negócio — apenas sinaliza "sem representação
   * operacional válida agora", continuando puro e determinístico.
   *
   * @param activity     Activity lida de staging, com occurrences já parseado
   *                     (PublishableActivityRepository) e resolvedPublicVenueId
   *                     resolvido (pode ser null — proposed_new, Architecture
   *                     Book v1.1 §5.3).
   * @param publishedAt  Timestamp a gravar em last_published_at — sempre
   *                     injectado pelo chamador (ActivityPublisher).
   * @param asOf         Instante de referência para "ocorrência futura"
   *                     (ADR-0020) — sempre injectado, nunca new Date() aqui.
   *                     Mesma entrada + mesmo publishedAt + mesmo asOf →
   *                     sempre a mesma saída.
   */
  static transformActivity(
    activity: PublishableActivity,
    publishedAt: Date,
    asOf: Date,
  ): OperationalActivityInput | null {
    const nextOccurrence = selectNextOccurrence(activity.occurrences, asOf);
    if (nextOccurrence === null) {
      return null;
    }

    const { startDate, endDate } = occurrenceToDateRange(nextOccurrence);

    return {
      title:              activity.title,
      description:        activity.description,
      start_date:         startDate,
      end_date:           endDate,
      // imagem_url (typo intencional) — ADR-0015: raw_activity_items.image_url →
      // public.activities.imagem_url. Typo não corrigido nesta fase.
      imagem_url:         activity.imageUrl,
      url:                activity.sourceUrl,
      phone:              activity.phone,
      // null permitido — activity com venue_resolution_status = proposed_new.
      venue_id:           activity.resolvedPublicVenueId,
      // Level 3, 2026-09-23 — identidade estável, não mais activity.stagingId.
      engine_activity_id: deriveEngineActivityId(activity.sourceKey, activity.sourceItemId) as OperationalActivityInput['engine_activity_id'],
      source_key:         activity.sourceKey,
      product_key:        activity.productKey,
      engine_status:      'active',
      last_published_at:  publishedAt,
    };
  }
}
