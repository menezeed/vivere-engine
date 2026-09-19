/**
 * src/publishing/repositories/impl/PublishableVenueRepository.ts
 * Lê venues de staging prontos para publicar. Zero escrita.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublishableVenueRepository } from '../interfaces.js';
import type { PublishableVenue, PublicVenueId, StagingVenueId } from '../../types/domain.js';

const SELECT = `
  id, product_key, promoted_venue_id, city, name,
  raw_venue_items!inner (
    source_key,
    name,
    address, lat, lng, phone, website,
    opening_hours_raw, image_url, collected_at
  )
`;

/**
 * Sprint 8.7 — precedência de nome (regra oficial confirmada):
 * venues_staging.name = nome curado pelo operador, tem precedência quando
 * não-NULL e não-vazio (após trim); raw_venue_items.name = nome original
 * da fonte, nunca alterado, usado como fallback. String vazia ou só
 * espaços em venues_staging.name é tratada como ausência de curadoria —
 * cai para o fallback, não é publicada como nome vazio.
 */
export function resolveVenueName(curated: unknown, rawName: unknown): string {
  const curatedName = typeof curated === 'string' ? curated.trim() : '';
  const fallbackName = typeof rawName === 'string' ? rawName.trim() : '';
  return curatedName.length > 0 ? curatedName : fallbackName;
}

function mapRow(row: Record<string, unknown>): PublishableVenue {
  const raw = row['raw_venue_items'] as Record<string, unknown>;

  return {
    stagingId:        row['id'] as StagingVenueId,
    productKey:       row['product_key'] as string,
    sourceKey:        (raw['source_key'] as string | null) ?? 'google_places',
    name:             resolveVenueName(row['name'], raw['name']),
    address:          (raw['address'] as string | null) ?? null,
    lat:              (raw['lat'] as number | null) ?? null,
    lng:              (raw['lng'] as number | null) ?? null,
    phone:            (raw['phone'] as string | null) ?? null,
    website:          (raw['website'] as string | null) ?? null,
    openingHoursRaw:  (raw['opening_hours_raw'] as string | null) ?? null,
    imageUrl:         (raw['image_url'] as string | null) ?? null,
    promotedVenueId:  (row['promoted_venue_id'] as string | null) as PublicVenueId | null,
    // Sprint 8.7 (bugfix de schema real): venues_staging não tem coluna updated_at
    // (nunca teve — o Architecture Book v1.1 §4.1 assumia-a incorrectamente).
    // O sinal correcto de "dado potencialmente alterado" é o collected_at do
    // raw_venue_item ligado — uma nova recolha da fonte é o evento que justifica
    // reavaliar o dirty check, coerente com "re-ingestão com dados novos" (§4.2).
    stagingUpdatedAt: new Date(raw['collected_at'] as string ?? Date.now()),
    // Informativo — ver comentário no tipo PublishableVenue (domain.ts).
    city:             (row['city'] as string | null) ?? null,
  };
}

export class PublishableVenueRepository implements IPublishableVenueRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findUnpublished(productKey: string): Promise<readonly PublishableVenue[]> {
    const { data, error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .eq('proposal_status', 'promoted')
      // ADR-0022 (Regional Geographic Gate) — defesa em profundidade:
      // proposal_status e geographic_status são colunas independentes
      // (migration 0018); nada impede estruturalmente que um humano
      // promova por engano um item outside_region. Este filtro garante
      // que a Publishing Engine nunca publica esse caso, mesmo assim.
      // neq() sozinho excluiria incorretamente as linhas com
      // geographic_status NULL (fontes sem região, ou dado anterior à
      // ADR-0022) — por isso o or() inclui NULL explicitamente.
      .or('geographic_status.is.null,geographic_status.neq.outside_region')
      .is('promoted_venue_id', null);

    if (error) throw new Error(`PublishableVenueRepository.findUnpublished: ${error.message}`);
    return (data ?? []).map(r => mapRow(r as Record<string, unknown>));
  }

  async findDirty(productKey: string): Promise<readonly PublishableVenue[]> {
    // Venues já publicados, candidatos a reavaliação. O dirty check real
    // (raw_venue_items.collected_at vs public.venues.last_published_at) é
    // feito em memória no VenuePublisher via
    // IPublicVenueRepository.findPublicationStateByEngineId (Sprint 8.4).
    // Aqui devolvemos todos os venues promoted com promoted_venue_id preenchido.
    const { data, error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .eq('proposal_status', 'promoted')
      // ADR-0022 — mesma defesa em profundidade que findUnpublished().
      .or('geographic_status.is.null,geographic_status.neq.outside_region')
      .not('promoted_venue_id', 'is', null);

    if (error) throw new Error(`PublishableVenueRepository.findDirty: ${error.message}`);
    return (data ?? []).map(r => mapRow(r as Record<string, unknown>));
  }

  async findToArchive(productKey: string): Promise<readonly PublishableVenue[]> {
    // Venues que já foram publicados mas foram rejeitados depois.
    // Sem filtro de geographic_status aqui, deliberadamente: arquivar um
    // item que porventura já esteja publicado continua o comportamento
    // correto, independentemente da geografia.
    const { data, error } = await this.db
      .schema('staging')
      .from('venues_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .eq('proposal_status', 'rejected')
      .not('promoted_venue_id', 'is', null);

    if (error) throw new Error(`PublishableVenueRepository.findToArchive: ${error.message}`);
    return (data ?? []).map(r => mapRow(r as Record<string, unknown>));
  }
}
