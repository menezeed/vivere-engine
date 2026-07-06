/**
 * entity-resolution/utils/geo.ts
 *
 * GeoUtils — utilitários de geolocalização para Entity Resolution.
 *
 * PRINCÍPIOS:
 * — Zero dependências externas. Matemática pura.
 * — Determinístico — mesma entrada, mesma saída.
 * — Cada função testável isoladamente.
 *
 * NOTA ARQUITECTURAL sobre o GeoMatcher:
 * VenueMention não contém coordenadas — a fonte editorial apenas menciona
 * um nome de local em texto. O ponto de referência geográfico da actividade
 * é derivado do centroide da cidade de origem (source_region_label).
 * Esta é uma heurística consciente — o GeoMatcher amplifica o NameMatcher
 * quando o venue está próximo do centro da cidade da actividade.
 * Quando existir geocodificação futura da menção, o GeoMatcher melhorará
 * automaticamente sem mudança de interface.
 */

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface GeoDistance {
  readonly meters:      number;
  readonly kilometers:  number;
}

// ── Haversine ─────────────────────────────────────────────────────────────────

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Distância Haversine entre dois pontos geográficos.
 * Precisão: ±0.3% (suficiente para matching de venues urbanos).
 */
export function haversineDistance(a: GeoPoint, b: GeoPoint): GeoDistance {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  const meters = EARTH_RADIUS_METERS * c;

  return { meters, kilometers: meters / 1000 };
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ── Score por distância ───────────────────────────────────────────────────────

/**
 * Converte distância em metros para score de geo-matching (0.0–1.0).
 *
 * Tabela calibrada para venues urbanos (Architecture Book v1.2, Cap. 6.2):
 *
 *   < 100m  → 1.00  (praticamente o mesmo ponto)
 *   < 500m  → 0.85  (mesmo quarteirão/bloco)
 *   < 1km   → 0.70  (mesmo bairro)
 *   < 2km   → 0.50  (cidade pequena, ainda plausível)
 *   < 5km   → 0.30  (distância máxima default do PreFilter)
 *   ≥ 5km   → 0.00  (improvável — PreFilter devia ter eliminado)
 */
export function distanceToScore(meters: number): number {
  if (meters < 100)    return 1.00;
  if (meters < 500)    return 0.85;
  if (meters < 1_000)  return 0.70;
  if (meters < 2_000)  return 0.50;
  if (meters < 5_000)  return 0.30;
  return 0.00;
}

/**
 * Calcula score geo directamente entre dois pontos.
 * Combina haversineDistance + distanceToScore.
 */
export function geoScore(a: GeoPoint, b: GeoPoint): { score: number; distanceMeters: number } {
  const dist = haversineDistance(a, b);
  return {
    score:          distanceToScore(dist.meters),
    distanceMeters: dist.meters,
  };
}

// ── Centroides de cidades ─────────────────────────────────────────────────────

/**
 * Centroides geográficos das cidades actualmente suportadas.
 * Usado como ponto de referência quando a VenueMention não tem coordenadas.
 *
 * POLÍTICA: o centroide é um ponto aproximado — serve apenas para o GeoMatcher
 * reduzir o pool de candidatos mais distantes. A precisão real vem do NameMatcher.
 *
 * EXTENSÃO: adicionar novas cidades aqui quando novos Collectors forem activados.
 * O motor não conhece esta tabela directamente — recebe o centroide como parâmetro.
 */
export const CITY_CENTROIDS: Record<string, GeoPoint> = {
  // Região dos Lagos — RJ, Brasil
  'cabo frio rj':         { lat: -22.8806, lng: -42.0187 },
  'cabo frio':            { lat: -22.8806, lng: -42.0187 },
  'sao pedro da aldeia rj': { lat: -22.8386, lng: -42.0991 },
  'são pedro da aldeia rj': { lat: -22.8386, lng: -42.0991 },
  'sao pedro da aldeia':  { lat: -22.8386, lng: -42.0991 },
  'iguaba grande rj':     { lat: -22.8389, lng: -42.2276 },
  'iguaba grande':        { lat: -22.8389, lng: -42.2276 },
  // UK — futuro (ADR-0010)
  'richmond uk':          { lat:  51.4613, lng:  -0.3037 },
  'richmond':             { lat:  51.4613, lng:  -0.3037 },
} as const;

/**
 * Retorna o centroide de uma cidade a partir do label da fonte.
 * Normaliza o label antes de pesquisar (lowercase, trim).
 * Retorna null se a cidade não for reconhecida.
 */
export function getCityCentroid(cityLabel: string): GeoPoint | null {
  const key = cityLabel.toLowerCase().trim();
  return CITY_CENTROIDS[key] ?? null;
}

// ── Bounding box (optimização futura — documentado aqui) ─────────────────────

/**
 * Calcula um bounding box aproximado em torno de um ponto.
 * Útil para pré-filtrar venues no banco sem Haversine completo.
 * Não usado ainda — documentado para quando o volume justificar.
 *
 * Precisão: ±0.1% para latitudes até 60° (suficiente para Brasil e UK).
 */
export function boundingBox(
  center: GeoPoint,
  radiusMeters: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const latDelta = (radiusMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const lngDelta = latDelta / Math.cos(toRad(center.lat));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}
