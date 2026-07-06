/**
 * entity-resolution/__tests__/geo-address-matcher.test.ts
 *
 * Testes do GeoMatcher, AddressMatcher e GeoUtils.
 * Zero dependências externas — coordenadas reais dos venues em staging.
 */

import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  distanceToScore,
  geoScore,
  getCityCentroid,
  boundingBox,
} from '../utils/geo.js';
import { GeoMatcher, createGeoMatcher, createGeoMatcherWithReference } from '../matchers/GeoMatcher.js';
import { AddressMatcher, createAddressMatcher } from '../matchers/AddressMatcher.js';
import type { VenueCandidate, VenueStagingId } from '../types/domain.js';
import type { VenueMention } from '../../types/RawActivityItem.js';

// ── Fixtures com dados reais do banco ────────────────────────────────────────

function mention(
  raw_text: string,
  raw_address_text: string | null = null,
  confidence_hint: VenueMention['confidence_hint'] = 'explicit_name',
): VenueMention {
  return { raw_text, raw_address_text, confidence_hint };
}

function candidate(overrides: Partial<VenueCandidate> & { name: string }): VenueCandidate {
  return {
    id:                   'venue-test' as VenueStagingId,
    product_key:          'vivere-60-mais',
    address:              null,
    city:                 'Cabo Frio RJ',
    lat:                  null,
    lng:                  null,
    google_types:         [],
    source_category_hint: null,
    proposal_status:      'approved',
    ...overrides,
  };
}

// Venues reais do banco (coordenadas do painel)
const ACADEMIA_NITRO_GYM = candidate({
  name:    'Academia nitro gym',
  city:    'Iguaba Grande RJ',
  lat:     -22.8465232,
  lng:     -42.2290573,
  address: 'Rod. Amaral Peixoto, 365 - Parque Tamariz, Iguaba Grande - RJ',
});

const ACADEMIA_VIVA_100 = candidate({
  name:    'Academia Viva 100%',
  city:    'São Pedro da Aldeia RJ',
  lat:     -22.8397518,
  lng:     -42.0696211,
  address: 'R. Silva Jardim, 1076 - Campo Redondo, São Pedro da Aldeia - RJ',
});

const ACADEMIA_DA_SAUDE = candidate({
  name:    'ACADEMIA DA SAÚDE',
  city:    'Iguaba Grande RJ',
  lat:     -22.8293085,
  lng:     -42.2334412,
  address: 'R. das Begônias, 169 - Jardim Solares, Iguaba Grande - RJ',
});

// Venues estimados de Cabo Frio (coordenadas aproximadas)
const PRAIA_DO_FORTE = candidate({
  name: 'Praia do Forte',
  city: 'Cabo Frio RJ',
  lat:  -22.875,
  lng:  -42.008,
});

const FORTE_SAO_MATEUS = candidate({
  name: 'Forte São Mateus',
  city: 'Cabo Frio RJ',
  lat:  -22.877,
  lng:  -42.007,
});

const MUSEU_JOSE_DOME = candidate({
  name:    'Museu José de Dome',
  city:    'Cabo Frio RJ',
  lat:     -22.879,
  lng:     -42.019,
  address: 'Centro, Cabo Frio - RJ',
});

// ── 1. GeoUtils — funções individuais ────────────────────────────────────────

describe('haversineDistance', () => {
  it('mesmo ponto → distância zero', () => {
    const d = haversineDistance({ lat: -22.879, lng: -42.019 }, { lat: -22.879, lng: -42.019 });
    expect(d.meters).toBeCloseTo(0, 0);
  });

  it('Cabo Frio → São Pedro da Aldeia (~9-12km)', () => {
    const cabofrio  = { lat: -22.8806, lng: -42.0187 };
    const saopedro  = { lat: -22.8386, lng: -42.0991 };
    const d = haversineDistance(cabofrio, saopedro);
    expect(d.kilometers).toBeGreaterThan(8);
    expect(d.kilometers).toBeLessThan(15);
  });

  it('Cabo Frio → Iguaba Grande (~18km)', () => {
    const cabofrio = { lat: -22.8806, lng: -42.0187 };
    const iguaba   = { lat: -22.8389, lng: -42.2276 };
    const d = haversineDistance(cabofrio, iguaba);
    expect(d.kilometers).toBeGreaterThan(15);
    expect(d.kilometers).toBeLessThan(25);
  });

  it('Academia nitro gym → Academia da Saúde (mesma cidade, ~2km)', () => {
    const a = { lat: ACADEMIA_NITRO_GYM.lat!, lng: ACADEMIA_NITRO_GYM.lng! };
    const b = { lat: ACADEMIA_DA_SAUDE.lat!, lng: ACADEMIA_DA_SAUDE.lng! };
    const d = haversineDistance(a, b);
    expect(d.kilometers).toBeLessThan(5);
  });

  it('resultado em metros e km consistentes', () => {
    const d = haversineDistance({ lat: -22.879, lng: -42.019 }, { lat: -22.880, lng: -42.020 });
    expect(d.meters).toBeCloseTo(d.kilometers * 1000, 1);
  });
});

describe('distanceToScore', () => {
  it('< 100m → 1.00', () => expect(distanceToScore(50)).toBe(1.00));
  it('< 500m → 0.85', () => expect(distanceToScore(200)).toBe(0.85));
  it('< 1km  → 0.70', () => expect(distanceToScore(700)).toBe(0.70));
  it('< 2km  → 0.50', () => expect(distanceToScore(1500)).toBe(0.50));
  it('< 5km  → 0.30', () => expect(distanceToScore(3000)).toBe(0.30));
  it('≥ 5km  → 0.00', () => expect(distanceToScore(6000)).toBe(0.00));
  it('exactamente 100m → 0.85 (limite exclusivo)', () => expect(distanceToScore(100)).toBe(0.85));
});

describe('getCityCentroid', () => {
  it('retorna centroide de Cabo Frio RJ', () => {
    const c = getCityCentroid('Cabo Frio RJ');
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo(-22.88, 1);
  });

  it('case-insensitive e trim', () => {
    const c = getCityCentroid('  CABO FRIO RJ  ');
    expect(c).not.toBeNull();
  });

  it('retorna null para cidade desconhecida', () => {
    expect(getCityCentroid('Cidade Inexistente')).toBeNull();
  });

  it('retorna centroide de São Pedro da Aldeia RJ', () => {
    const c = getCityCentroid('São Pedro da Aldeia RJ');
    expect(c).not.toBeNull();
    expect(c!.lng).toBeCloseTo(-42.10, 1);
  });

  it('retorna centroide de Iguaba Grande RJ', () => {
    const c = getCityCentroid('Iguaba Grande RJ');
    expect(c).not.toBeNull();
  });
});

// ── 2. GeoMatcher ────────────────────────────────────────────────────────────

describe('GeoMatcher', () => {
  it('id é "geo"', () => {
    expect(new GeoMatcher().id).toBe('geo');
  });

  it('retorna null quando candidato não tem coordenadas', () => {
    const m = createGeoMatcher('Cabo Frio RJ');
    const s = m.score(mention('Praia do Forte'), candidate({ name: 'Venue sem coords' }));
    expect(s).toBeNull();
  });

  it('retorna null quando candidato não tem city e não há configuração', () => {
    const m = new GeoMatcher(); // sem cityLabel nem referencePoint
    const semCity = candidate({ name: 'Venue sem cidade', city: undefined as any, lat: -22.879, lng: -42.019 });
    semCity.city === null; // city null → não há centroide possível
    const candidateSemCity: VenueCandidate = { ...semCity, city: null };
    const s = m.score(mention('Praia do Forte'), candidateSemCity);
    expect(s).toBeNull();
  });

  it('score 1.0 quando candidato está a < 100m da referência', () => {
    // Referência = Praia do Forte, candidato = Praia do Forte (mesmo ponto)
    const m = createGeoMatcherWithReference({ lat: -22.875, lng: -42.008 });
    const s = m.score(mention('Praia do Forte'), PRAIA_DO_FORTE);
    expect(s).not.toBeNull();
    expect(s!.value).toBe(1.0);
    expect(s!.method).toBe('geo');
    expect(s!.subMethod).toBe('haversine');
  });

  it('score 0.85 para Forte São Mateus próximo de Praia do Forte (~200m)', () => {
    // Referência = Praia do Forte, candidato = Forte São Mateus (~200m de distância)
    const m = createGeoMatcherWithReference({ lat: -22.875, lng: -42.008 });
    const s = m.score(mention('Canto do Forte'), FORTE_SAO_MATEUS);
    expect(s).not.toBeNull();
    expect(s!.value).toBe(0.85);
  });

  it('score via centroide da cidade: Academia nitro gym + Iguaba Grande', () => {
    const m = createGeoMatcher('Iguaba Grande RJ');
    const s = m.score(mention('Academia'), ACADEMIA_NITRO_GYM);
    expect(s).not.toBeNull();
    // Nitro gym está a < 2km do centroide de Iguaba Grande → score ≥ 0.50
    expect(s!.value).toBeGreaterThanOrEqual(0.50);
  });

  it('score via centroide da cidade: Academia Viva 100% + São Pedro da Aldeia', () => {
    const m = createGeoMatcher('São Pedro da Aldeia RJ');
    const s = m.score(mention('Academia'), ACADEMIA_VIVA_100);
    expect(s).not.toBeNull();
    // Academia Viva pode estar a 2-5km do centroide de São Pedro → score ≥ 0.30
    expect(s!.value).toBeGreaterThanOrEqual(0.30);
  });

  it('usa campo city do candidato quando não há configuração de cidade', () => {
    // GeoMatcher sem configuração usa city do candidato
    const m = new GeoMatcher();
    const s = m.score(mention('Academia'), ACADEMIA_NITRO_GYM);
    // ACADEMIA_NITRO_GYM.city = 'Iguaba Grande RJ' → deve encontrar centroide
    expect(s).not.toBeNull();
    expect(s!.value).toBeGreaterThan(0);
  });

  it('score 0.0 para venue de outra cidade sem overlap', () => {
    // Referência = Cabo Frio, candidato = Academia Viva 100% em São Pedro (~15km)
    const m = createGeoMatcherWithReference({ lat: -22.8806, lng: -42.0187 });
    const s = m.score(mention('Academia'), ACADEMIA_VIVA_100);
    expect(s).not.toBeNull();
    expect(s!.value).toBe(0.0); // > 5km → 0
  });

  it('detail inclui distância legível', () => {
    const m = createGeoMatcherWithReference({ lat: -22.875, lng: -42.008 });
    const s = m.score(mention('Praia'), PRAIA_DO_FORTE);
    expect(s!.detail).toContain('m');
  });

  it('score entre 0 e 1 para todos os casos', () => {
    const m = createGeoMatcherWithReference({ lat: -22.8806, lng: -42.0187 });
    const candidates = [PRAIA_DO_FORTE, FORTE_SAO_MATEUS, MUSEU_JOSE_DOME, ACADEMIA_VIVA_100];
    for (const c of candidates) {
      const s = m.score(mention('x'), c);
      if (s !== null) {
        expect(s.value).toBeGreaterThanOrEqual(0);
        expect(s.value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('GeoMatcher amplifica NameMatcher para Praia do Forte vs Forte São Mateus', () => {
    // Demonstra o valor do GeoMatcher: Praia do Forte e Forte São Mateus
    // têm nomes diferentes mas estão a ~200m um do outro
    const ref = { lat: -22.875, lng: -42.008 }; // Praia do Forte
    const m   = createGeoMatcherWithReference(ref);
    const praiaScore = m.score(mention('Praia'), PRAIA_DO_FORTE);
    const forteScore = m.score(mention('Forte'), FORTE_SAO_MATEUS);
    // Ambos próximos → ambos com score alto
    expect(praiaScore!.value).toBeGreaterThanOrEqual(0.85);
    expect(forteScore!.value).toBeGreaterThanOrEqual(0.85);
    // Isso confirma que o GeoMatcher sozinho não distingue os dois —
    // precisa do NameMatcher para desempatar (comportamento correcto)
  });
});

// ── 3. AddressMatcher ────────────────────────────────────────────────────────

describe('AddressMatcher', () => {
  const addr = createAddressMatcher();

  it('id é "address"', () => expect(addr.id).toBe('address'));

  it('retorna null quando menção não tem raw_address_text', () => {
    const s = addr.score(mention('Museu José de Dome', null), MUSEU_JOSE_DOME);
    expect(s).toBeNull();
  });

  it('retorna null quando candidato não tem address', () => {
    const s = addr.score(
      mention('Praia', 'R. das Begônias, 169'),
      candidate({ name: 'Venue', address: null }),
    );
    expect(s).toBeNull();
  });

  it('retorna null quando raw_address_text é string vazia', () => {
    const s = addr.score(mention('x', ''), MUSEU_JOSE_DOME);
    expect(s).toBeNull();
  });

  it('exact match de endereço normalizado → score máximo (0.70)', () => {
    const s = addr.score(
      mention('Venue', 'R. das Begônias, 169 - Jardim Solares, Iguaba Grande - RJ'),
      ACADEMIA_DA_SAUDE,
    );
    expect(s).not.toBeNull();
    expect(s!.value).toBeCloseTo(0.70, 1);
    expect(s!.subMethod).toBe('exact');
  });

  it('contains match: endereço parcial encontrado no completo', () => {
    const s = addr.score(
      mention('Academia', 'R. das Begônias, 169'),
      ACADEMIA_DA_SAUDE,
    );
    expect(s).not.toBeNull();
    expect(s!.value).toBeGreaterThan(0.30);
    expect(s!.value).toBeLessThanOrEqual(0.70);
  });

  it('token overlap: rua parcialmente coincidente', () => {
    const s = addr.score(
      mention('Academia', 'Silva Jardim Campo Redondo Sao Pedro'),
      ACADEMIA_VIVA_100,
    );
    expect(s).not.toBeNull();
    expect(s!.value).toBeGreaterThan(0);
    expect(s!.value).toBeLessThanOrEqual(0.70);
  });

  it('score máximo nunca excede 0.70', () => {
    // Mesmo com exact match, score está clipado a maxScore
    const s = addr.score(
      mention('x', 'R. das Begônias, 169 - Jardim Solares, Iguaba Grande - RJ'),
      ACADEMIA_DA_SAUDE,
    );
    expect(s!.value).toBeLessThanOrEqual(0.70);
  });

  it('score 0 a 0.70 para todos os casos com endereço', () => {
    const cases: [VenueMention, VenueCandidate][] = [
      [mention('x', 'R. das Begônias, 169'), ACADEMIA_DA_SAUDE],
      [mention('x', 'Silva Jardim, 1076'), ACADEMIA_VIVA_100],
      [mention('x', 'Rod. Amaral Peixoto, 365'), ACADEMIA_NITRO_GYM],
      [mention('x', 'Rua completamente diferente, 999'), ACADEMIA_DA_SAUDE],
    ];
    for (const [m, c] of cases) {
      const s = addr.score(m, c);
      if (s !== null) {
        expect(s.value).toBeGreaterThanOrEqual(0);
        expect(s.value).toBeLessThanOrEqual(0.70);
      }
    }
  });

  it('method é sempre "address"', () => {
    const s = addr.score(mention('x', 'R. das Begônias'), ACADEMIA_DA_SAUDE);
    if (s) expect(s.method).toBe('address');
  });

  it('detail é legível por humano', () => {
    const s = addr.score(mention('x', 'R. das Begônias, 169'), ACADEMIA_DA_SAUDE);
    if (s) {
      expect(s.detail).toBeTruthy();
      expect(s.detail.length).toBeGreaterThan(5);
    }
  });
});

// ── 4. boundingBox (utilitário documentado) ───────────────────────────────────

describe('boundingBox', () => {
  it('retorna bounding box com 4 coordenadas', () => {
    const bb = boundingBox({ lat: -22.88, lng: -42.02 }, 5000);
    expect(bb.minLat).toBeLessThan(bb.maxLat);
    expect(bb.minLng).toBeLessThan(bb.maxLng);
  });

  it('raio 5km gera bounding box de ~10km de lado', () => {
    const center = { lat: -22.88, lng: -42.02 };
    const bb = boundingBox(center, 5000);
    const latSpanKm = haversineDistance(
      { lat: bb.minLat, lng: center.lng },
      { lat: bb.maxLat, lng: center.lng },
    ).kilometers;
    expect(latSpanKm).toBeCloseTo(10, 0);
  });
});
