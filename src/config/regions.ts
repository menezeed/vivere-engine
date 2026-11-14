/**
 * Registo declarativo de regiões (cidades) — L3/E2.
 *
 * Substitui as regiões codificadas à mão em pilotRegion.ts (duas
 * entradas fixas + um ternário para o rótulo). Cada cidade é UMA
 * entrada neste array: centro, raio, rótulo usado nas queries e as
 * fontes (source_key) que a cobrem. Nenhum código deve ramificar pelo
 * nome de uma cidade — tudo o que varia por cidade vive aqui.
 *
 * Adicionar uma cidade = acrescentar uma entrada a REGIONS + um teste
 * em src/config/__tests__/regions.test.ts. validateRegions() é
 * executado pelos testes e falha ruidosamente com chaves duplicadas,
 * coordenadas fora do intervalo, raio inválido ou rótulo vazio.
 *
 * NOTA: a configuração Google Places em uso pelos scripts
 * (src/collectors/google-places/config/vivere-60-mais.ts) mantém a sua
 * própria lista de regiões; esta mudança não a altera.
 *
 * NOTA SOBRE COORDENADAS: os centróides de Cabo Frio e Araruama são
 * aproximações do centro urbano (valores herdados de pilotRegion.ts,
 * sem alteração). Novas entradas devem usar coordenadas confirmadas
 * num mapa, não estimadas.
 */

export interface RegionDefinition {
  /** Identificador estável (snake_case) — usado em logs e como region_key das queries */
  key: string;
  /** Rótulo usado no texto das queries (ex: "Cabo Frio RJ") */
  city_label: string;
  /** Nome da cidade como aparece em region_metadata.city das fontes */
  city: string;
  /** UF */
  state: string;
  center: { lat: number; lng: number };
  radius_m: number;
  /**
   * source_key das fontes que cobrem esta cidade (ex: 'google_places',
   * 'prefeitura_cabo_frio'). Fontes WordPress têm de existir no registo
   * src/collectors/wordpress-content/config/registry.ts (verificado em teste).
   */
  sources: readonly string[];
}

export const GOOGLE_PLACES_SOURCE_KEY = 'google_places';

export const REGIONS: readonly RegionDefinition[] = [
  {
    key: 'cabo_frio',
    city_label: 'Cabo Frio RJ',
    city: 'Cabo Frio',
    state: 'RJ',
    center: { lat: -22.8894, lng: -42.0188 },
    radius_m: 12000,
    sources: [GOOGLE_PLACES_SOURCE_KEY, 'prefeitura_cabo_frio'],
  },
  {
    key: 'araruama',
    city_label: 'Araruama RJ',
    city: 'Araruama',
    state: 'RJ',
    center: { lat: -22.8717, lng: -42.3433 },
    radius_m: 12000,
    // O portal municipal não é WordPress (sem /wp-json nem RSS — mapa de
    // fontes L1, 14/11/2026); só Google Places por agora.
    sources: [GOOGLE_PLACES_SOURCE_KEY],
  },
];

/**
 * Validação estrutural de um registo de regiões. Função pura — os
 * testes aplicam-na ao registo real e a registos sintéticos.
 */
export function validateRegions(regions: readonly RegionDefinition[]): void {
  const seen = new Set<string>();
  for (const r of regions) {
    if (!/^[a-z][a-z0-9_]*$/.test(r.key)) {
      throw new Error(`regions.ts: key inválida "${r.key}" (esperado snake_case)`);
    }
    if (seen.has(r.key)) {
      throw new Error(`regions.ts: key duplicada "${r.key}"`);
    }
    seen.add(r.key);
    if (r.city_label.trim() === '' || r.city.trim() === '' || r.state.trim() === '') {
      throw new Error(`regions.ts: "${r.key}" tem city_label, city ou state vazio`);
    }
    const { lat, lng } = r.center;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new Error(`regions.ts: "${r.key}" tem coordenadas fora do intervalo`);
    }
    if (!Number.isInteger(r.radius_m) || r.radius_m <= 0 || r.radius_m > 50000) {
      throw new Error(`regions.ts: "${r.key}" tem radius_m inválido (${r.radius_m})`);
    }
    if (new Set(r.sources).size !== r.sources.length) {
      throw new Error(`regions.ts: "${r.key}" tem sources duplicadas`);
    }
  }
}

export function getRegion(
  key: string,
  regions: readonly RegionDefinition[] = REGIONS,
): RegionDefinition {
  const region = regions.find((r) => r.key === key);
  if (!region) {
    throw new Error(`regions.ts: região "${key}" não existe no registo`);
  }
  return region;
}
