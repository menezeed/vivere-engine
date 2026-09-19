/**
 * src/publishing/services/duplicateDetection.ts
 *
 * Sprint 8.7 — relatório de possíveis venues duplicados entre os candidatos
 * a `insert` de uma run, para revisão humana antes da primeira publicação.
 *
 * NÃO faz dedupe automático — apenas agrupa e reporta. A decisão de mesclar,
 * rejeitar, ou publicar os dois como locais distintos com o mesmo nome comum
 * (ex: duas praias diferentes chamadas "Praia do Forte") fica com o humano.
 *
 * Critério: mesmo nome normalizado (minúsculas, sem acentos, espaços
 * colapsados). Distância entre coordenadas é informativa (ajuda o humano a
 * decidir), não é usada para expandir nem restringir o agrupamento — dois
 * venues com o mesmo nome normalizado são sempre reportados juntos,
 * independentemente da distância.
 *
 * Fora de escopo (deliberadamente): fuzzy-matching de nomes distintos,
 * dedupe cross-source mais sofisticado — isso é trabalho do Entity
 * Resolution (Fase 7, congelada), não deste relatório pontual.
 */

export interface VenueForDuplicateCheck {
  readonly stagingId: string;
  readonly name:      string;
  readonly city:      string | null;
  readonly lat:       number | null;
  readonly lng:       number | null;
}

export interface VenueDuplicateGroup {
  readonly normalizedName:    string;
  readonly members:           readonly VenueForDuplicateCheck[];
  /** Maior distância em metros entre pares do grupo com coordenadas; null se <2 membros tiverem lat/lng. */
  readonly maxDistanceMeters: number | null;
}

/** Minúsculas, sem diacríticos, espaços colapsados e sem padding. */
export function normalizeVenueName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

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

/**
 * Agrupa venues por nome normalizado; devolve apenas grupos com 2+ membros
 * (staging IDs diferentes) — candidatos a duplicado para revisão humana.
 */
export function detectVenueDuplicates(
  venues: readonly VenueForDuplicateCheck[],
): readonly VenueDuplicateGroup[] {
  const groups = new Map<string, VenueForDuplicateCheck[]>();

  for (const venue of venues) {
    const key = normalizeVenueName(venue.name);
    const existing = groups.get(key);
    if (existing) existing.push(venue);
    else groups.set(key, [venue]);
  }

  const result: VenueDuplicateGroup[] = [];

  for (const [normalizedName, members] of groups) {
    if (members.length < 2) continue;

    let maxDistanceMeters: number | null = null;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!;
        const b = members[j]!;
        if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) continue;

        const distance = haversineMeters(a.lat, a.lng, b.lat, b.lng);
        if (maxDistanceMeters === null || distance > maxDistanceMeters) {
          maxDistanceMeters = distance;
        }
      }
    }

    result.push({ normalizedName, members, maxDistanceMeters });
  }

  // Grupos maiores primeiro — mais prováveis de precisar de atenção.
  return result.sort((a, b) => b.members.length - a.members.length);
}
