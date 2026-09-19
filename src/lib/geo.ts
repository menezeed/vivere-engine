/**
 * src/lib/geo.ts
 *
 * Utilitário geográfico genérico e puro — sem dependência de nenhum
 * domínio específico (venues, regiões, produtos). Usado pelo
 * Regional Geographic Gate (ADR-0022) e por qualquer outro cálculo de
 * distância que a plataforma precise.
 */

/** Distância em metros entre duas coordenadas (fórmula de Haversine). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // raio médio da Terra, em metros
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
