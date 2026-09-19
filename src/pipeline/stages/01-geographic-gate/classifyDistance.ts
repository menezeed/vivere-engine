/**
 * src/pipeline/stages/01-geographic-gate/classifyDistance.ts
 *
 * ADR-0022 — Regional Geographic Gate. Classificação pura, sem I/O.
 */

import { haversineMeters } from '../../../lib/geo';
import type { GeographicRegion, GeographicallyLocatable, GeographicClassification, GeographicBucket } from './types';

/**
 * Limites (ADR-0022):
 *   inside_radius:   distance <= radius_m
 *   buffer_zone:     radius_m  < distance <= radius_m + BUFFER_METERS
 *   outside_region:  distance  > radius_m + BUFFER_METERS
 *
 * BUFFER_METERS é uma margem de classificação fixa (500m), não um
 * segundo raio de busca — não é configurável por região nesta versão;
 * se isso vier a ser necessário, adicionar como campo opcional em
 * GeographicRegion, nunca como constante específica de uma região.
 */
export const BUFFER_METERS = 500;

export function classifyDistance(distanceMeters: number, radiusM: number): GeographicBucket {
  if (distanceMeters <= radiusM) return 'inside_radius';
  if (distanceMeters <= radiusM + BUFFER_METERS) return 'buffer_zone';
  return 'outside_region';
}

/**
 * Classifica um item geograficamente, encontrando a região correspondente
 * por source_region_label. Se a região não for encontrada (não deveria
 * acontecer, mas defensivo — nunca deve bloquear a ingestão), devolve
 * region: null e bucket: 'inside_radius' — comportamento conservador,
 * equivalente a "não aplicar o gate" quando não há como calcular.
 */
export function classifyItem(
  item: GeographicallyLocatable,
  regions: readonly GeographicRegion[],
): GeographicClassification {
  const region = item.source_region_label
    ? (regions.find((r) => r.display_label === item.source_region_label) ?? null)
    : null;

  if (!region) {
    return { distanceMeters: 0, bucket: 'inside_radius', region: null };
  }

  const distanceMeters = haversineMeters(region.lat, region.lng, item.lat, item.lng);
  return { distanceMeters, bucket: classifyDistance(distanceMeters, region.radius_m), region };
}
