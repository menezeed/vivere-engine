/**
 * Completude (Issue #52): o que falta a um registo do catálogo segundo os
 * campos que o formulário legado trata como necessários. Função pura; só
 * informa, nunca altera dados.
 */
import type { CatalogActivity, CatalogVenue } from './catalogTypes';

export type ActivityGap =
  | 'title' | 'category' | 'category_unknown' | 'venue' | 'date_or_recurrence' | 'price_or_free';
export type VenueGap = 'name' | 'address' | 'coordinates' | 'category';

export interface Completeness<G extends string> {
  complete: boolean;
  missing: G[];
}

export function activityCompleteness(a: CatalogActivity, categoryKeys?: ReadonlySet<string>): Completeness<ActivityGap> {
  const missing: ActivityGap[] = [];
  if (!a.title || a.title.trim() === '') missing.push('title');
  if (!a.category) missing.push('category');
  else if (categoryKeys && !categoryKeys.has(a.category)) missing.push('category_unknown');
  if (!a.venue_id) missing.push('venue');
  const recurrent = !!a.recurrence_type && a.recurrence_type !== 'none'
    && Array.isArray(a.recurrence_days) && a.recurrence_days.length > 0 && !!a.recurrence_time;
  if (!a.start_date && !recurrent) missing.push('date_or_recurrence');
  if (a.is_free !== true && !(typeof a.price === 'number' && a.price > 0)) missing.push('price_or_free');
  return { complete: missing.length === 0, missing };
}

export function venueCompleteness(v: CatalogVenue): Completeness<VenueGap> {
  const missing: VenueGap[] = [];
  if (!v.name || v.name.trim() === '') missing.push('name');
  if (!v.address) missing.push('address');
  const okLat = typeof v.lat === 'number' && v.lat >= -90 && v.lat <= 90;
  const okLng = typeof v.lng === 'number' && v.lng >= -180 && v.lng <= 180;
  if (!okLat || !okLng) missing.push('coordinates');
  if (!v.category) missing.push('category');
  return { complete: missing.length === 0, missing };
}
