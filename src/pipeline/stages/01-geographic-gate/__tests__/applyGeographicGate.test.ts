/**
 * src/pipeline/stages/01-geographic-gate/__tests__/applyGeographicGate.test.ts
 * ADR-0022 — Regional Geographic Gate.
 */

import { describe, it, expect } from 'vitest';
import { classifyDistance, classifyItem, BUFFER_METERS } from '../classifyDistance';
import { applyGeographicGate } from '../applyGeographicGate';
import type { GeographicRegion } from '../types';
import type { FilteredVenueItem } from '../../00-filter-venue/index';
import type { RawVenueItem } from '../../../../types/RawVenueItem';

const REGION: GeographicRegion = {
  display_label: 'Região Teste',
  lat: -23.610110,
  lng: -46.686907,
  radius_m: 2500,
};

// ── classifyDistance — os três limites exactos, pedidos explicitamente ──────

describe('classifyDistance — limites exactos (ADR-0022)', () => {
  it('exactamente no raio (distance === radius_m) → inside_radius', () => {
    expect(classifyDistance(2500, 2500)).toBe('inside_radius');
  });

  it('um metro dentro do raio → inside_radius', () => {
    expect(classifyDistance(2499, 2500)).toBe('inside_radius');
  });

  it('um metro acima do raio → buffer_zone', () => {
    expect(classifyDistance(2501, 2500)).toBe('buffer_zone');
  });

  it('exactamente em radius_m + 500 (limite superior do buffer) → buffer_zone', () => {
    expect(classifyDistance(3000, 2500)).toBe('buffer_zone');
  });

  it('um metro acima do buffer (radius_m + 500 + 1) → outside_region', () => {
    expect(classifyDistance(3001, 2500)).toBe('outside_region');
  });

  it('muito acima do buffer → outside_region', () => {
    expect(classifyDistance(9498, 2500)).toBe('outside_region');
  });

  it('BUFFER_METERS é 500, conforme ADR-0022', () => {
    expect(BUFFER_METERS).toBe(500);
  });

  it('genérico: funciona com qualquer radius_m, não só 2500 (ex: Cabo Frio, 12000)', () => {
    expect(classifyDistance(12000, 12000)).toBe('inside_radius');
    expect(classifyDistance(12500, 12000)).toBe('buffer_zone');
    expect(classifyDistance(12501, 12000)).toBe('outside_region');
  });
});

// ── classifyItem — integração com região por source_region_label ────────────

describe('classifyItem', () => {
  it('classifica correctamente um item dentro do raio', () => {
    const item = { lat: REGION.lat + 0.009, lng: REGION.lng, source_region_label: 'Região Teste' };
    const result = classifyItem(item, [REGION]);
    expect(result.bucket).toBe('inside_radius');
    expect(result.region).toEqual(REGION);
  });

  it('classifica correctamente um item muito distante como outside_region', () => {
    const item = { lat: -23.5614, lng: -46.6558, source_region_label: 'Região Teste' }; // MASP real
    const result = classifyItem(item, [REGION]);
    expect(result.bucket).toBe('outside_region');
    expect(result.distanceMeters).toBeGreaterThan(3000);
  });

  it('devolve region: null e bucket inside_radius (conservador) quando a região não é encontrada', () => {
    const item = { lat: 0, lng: 0, source_region_label: 'Região Inexistente' };
    const result = classifyItem(item, [REGION]);
    expect(result.region).toBeNull();
    expect(result.bucket).toBe('inside_radius');
  });

  it('é determinístico: mesma entrada → mesmo resultado', () => {
    const item = { lat: -23.615, lng: -46.69, source_region_label: 'Região Teste' };
    const r1 = classifyItem(item, [REGION]);
    const r2 = classifyItem(item, [REGION]);
    expect(r1).toEqual(r2);
  });
});

// ── applyGeographicGate — NUNCA remove itens (pós-revisão arquitectural) ────

type TestRuleId = 'accept_type_theater' | 'reject_type_x';
type TestAmbiguityLabel = 'likely_fitness_generic';

function makeFilteredItem(overrides: {
  lat: number;
  lng: number;
  decision?: 'accepted' | 'needs_review' | 'rejected' | TestAmbiguityLabel;
  name?: string;
}): FilteredVenueItem<TestRuleId, TestAmbiguityLabel> {
  return {
    item: {
      source_key: 'google_places',
      source_item_id: `place-${overrides.name ?? 'x'}`,
      collected_at: new Date().toISOString(),
      name: overrides.name ?? 'Venue Teste',
      address: null,
      lat: overrides.lat,
      lng: overrides.lng,
      phone: null,
      website: null,
      opening_hours_raw: null,
      image_url: null,
      source_category_hint: 'teatro',
      source_query_text: 'teatro em Região Teste',
      source_query_kind: 'place_type',
      source_region_label: 'Região Teste',
      google_types: ['performing_arts_theater'],
      google_business_status: 'OPERATIONAL',
      raw_payload: {},
    } satisfies RawVenueItem,
    filter: {
      decision: overrides.decision ?? 'accepted',
      matches: [],
      decisive_layer: 'accept',
      reasoning: 'Aceito por: accept_type_theater',
    },
  };
}

describe('applyGeographicGate — nunca remove itens do array', () => {
  it('devolve exactamente o mesmo número de itens recebidos, em qualquer bucket', () => {
    const items = [
      makeFilteredItem({ lat: REGION.lat, lng: REGION.lng, decision: 'accepted' }),          // inside_radius
      makeFilteredItem({ lat: REGION.lat + 0.0252, lng: REGION.lng, decision: 'accepted' }),  // buffer_zone
      makeFilteredItem({ lat: -23.5614, lng: -46.6558, decision: 'accepted' }),               // outside_region (MASP)
      makeFilteredItem({ lat: -23.5614, lng: -46.6558, decision: 'rejected' }),               // outside_region + rejected
    ];
    const gated = applyGeographicGate(items, [REGION]);

    expect(gated).toHaveLength(4); // nada foi removido
    expect(gated.map((g) => g.geographic.bucket)).toEqual([
      'inside_radius', 'buffer_zone', 'outside_region', 'outside_region',
    ]);
  });

  it('não muta os objectos originais — cada item gated é uma cópia nova', () => {
    const original = makeFilteredItem({ lat: -23.5614, lng: -46.6558, decision: 'accepted' });
    const snapshot = { ...original.filter };
    applyGeographicGate([original], [REGION]);
    expect(original.filter).toEqual(snapshot); // original intacto
  });
});

describe('applyGeographicGate — inside_radius', () => {
  it('preserva a decisão original sem alteração', () => {
    const item = makeFilteredItem({ lat: REGION.lat, lng: REGION.lng, decision: 'accepted' });
    const [gated] = applyGeographicGate([item], [REGION]);

    expect(gated!.filter.decision).toBe('accepted');
    expect(gated!.filter.reasoning).toBe('Aceito por: accept_type_theater'); // inalterado
    expect(gated!.geographic.bucket).toBe('inside_radius');
  });
});

describe('applyGeographicGate — buffer_zone', () => {
  it('força ACCEPTED para needs_review, com geographic_buffer_zone na reasoning', () => {
    const item = makeFilteredItem({ lat: REGION.lat + 0.0252, lng: REGION.lng, decision: 'accepted' });
    const [gated] = applyGeographicGate([item], [REGION]);

    expect(gated!.filter.decision).toBe('needs_review');
    expect(gated!.filter.reasoning).toContain('geographic_buffer_zone');
    expect(gated!.filter.decisive_layer).toBe('review');
    expect(gated!.geographic.bucket).toBe('buffer_zone');
  });

  it('preserva rejected na buffer_zone — só ACCEPTED é forçado', () => {
    const item = makeFilteredItem({ lat: REGION.lat + 0.0252, lng: REGION.lng, decision: 'rejected' });
    const [gated] = applyGeographicGate([item], [REGION]);

    expect(gated!.filter.decision).toBe('rejected');
    expect(gated!.filter.reasoning).not.toContain('geographic_buffer_zone');
  });

  it('preserva a decisão de ambiguity_fallback na buffer_zone', () => {
    const item = makeFilteredItem({ lat: REGION.lat + 0.0252, lng: REGION.lng, decision: 'likely_fitness_generic' });
    const [gated] = applyGeographicGate([item], [REGION]);

    expect(gated!.filter.decision).toBe('likely_fitness_generic');
  });
});

describe('applyGeographicGate — outside_region', () => {
  it('preserva a decisão original do filtro — a exclusão de elegibilidade é só via geographic.bucket', () => {
    const item = makeFilteredItem({ lat: -23.5614, lng: -46.6558, decision: 'accepted' }); // MASP
    const [gated] = applyGeographicGate([item], [REGION]);

    expect(gated!.filter.decision).toBe('accepted'); // decisão do TIPO continua accepted
    expect(gated!.geographic.bucket).toBe('outside_region'); // elegibilidade regional é que fica marcada
    expect(gated!.geographic.distanceMeters).toBeGreaterThan(3000);
  });

  it('funciona igualmente para itens já rejected pelo tipo — ambos os motivos ficam registados', () => {
    const item = makeFilteredItem({ lat: -23.5614, lng: -46.6558, decision: 'rejected' });
    const [gated] = applyGeographicGate([item], [REGION]);

    expect(gated!.filter.decision).toBe('rejected');
    expect(gated!.geographic.bucket).toBe('outside_region');
  });
});

describe('applyGeographicGate — genérico, múltiplas regiões', () => {
  it('classifica correctamente itens de regiões diferentes na mesma chamada', () => {
    const regionA: GeographicRegion = { display_label: 'Região A', lat: -22.8894, lng: -42.0188, radius_m: 12000 };
    const regionB: GeographicRegion = { display_label: 'Região B', lat: -23.610110, lng: -46.686907, radius_m: 2500 };

    const itemA = makeFilteredItem({ lat: -22.89, lng: -42.02, decision: 'accepted' });
    (itemA.item as { source_region_label: string }).source_region_label = 'Região A';

    const itemB = makeFilteredItem({ lat: -23.5614, lng: -46.6558, decision: 'accepted' }); // MASP
    (itemB.item as { source_region_label: string }).source_region_label = 'Região B';

    const gated = applyGeographicGate([itemA, itemB], [regionA, regionB]);

    expect(gated).toHaveLength(2); // nada removido
    expect(gated[0]!.geographic.bucket).toBe('inside_radius'); // itemA, dentro do raio de Região A
    expect(gated[1]!.geographic.bucket).toBe('outside_region'); // itemB, fora do raio de Região B
  });

  it('é puro: mesma entrada produz sempre a mesma saída', () => {
    const item = makeFilteredItem({ lat: REGION.lat, lng: REGION.lng, decision: 'accepted' });
    const r1 = applyGeographicGate([item], [REGION]);
    const r2 = applyGeographicGate([item], [REGION]);
    expect(r1).toEqual(r2);
  });
});
