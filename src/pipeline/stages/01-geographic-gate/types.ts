/**
 * src/pipeline/stages/01-geographic-gate/types.ts
 *
 * ADR-0022 — Regional Geographic Gate.
 *
 * Genérico para qualquer região de qualquer produto — nunca menciona
 * "Brooklin" ou qualquer bairro. Opera apenas sobre lat/lng do item e
 * lat/lng/radius_m da região que gerou a query, ambos já disponíveis
 * sem nenhuma chamada adicional.
 *
 * Revisão (pós-revisão arquitectural): o gate NUNCA remove itens do
 * fluxo. Todo item colectado continua rastreável até venues_staging —
 * a diferença entre inside_radius/buffer_zone/outside_region é sempre
 * uma anotação (GeographicMetadata) e, no máximo, um ajuste de
 * proposal_status na persistência — nunca uma exclusão silenciosa.
 */

export type GeographicBucket = 'inside_radius' | 'buffer_zone' | 'outside_region';

/** Forma mínima de uma região, suficiente para o gate — qualquer config de produto satisfaz isto estruturalmente. */
export interface GeographicRegion {
  readonly display_label: string;
  readonly lat: number;
  readonly lng: number;
  readonly radius_m: number;
}

/** Forma mínima de um item, suficiente para o gate — RawVenueItem satisfaz isto estruturalmente. */
export interface GeographicallyLocatable {
  readonly lat: number;
  readonly lng: number;
  readonly source_region_label?: string;
}

export interface GeographicClassification {
  readonly distanceMeters: number;
  readonly bucket: GeographicBucket;
  readonly region: GeographicRegion | null; // null quando não foi possível encontrar a região correspondente
}

/**
 * Metadado geográfico anexado a cada item pelo gate — nunca substitui
 * nem apaga a decisão original do Venue Filtering Engine. Persistido
 * como base para proposal_status = 'geographic_excluded' quando
 * bucket = 'outside_region' (ver VenueStagingRepository).
 */
export interface GeographicMetadata {
  readonly bucket: GeographicBucket;
  readonly distanceMeters: number;
}
