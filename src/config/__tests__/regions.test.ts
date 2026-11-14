import { describe, it, expect } from 'vitest';
import { REGIONS, GOOGLE_PLACES_SOURCE_KEY, validateRegions, getRegion, type RegionDefinition } from '../regions';
import { buildPilotQueries, PILOT_REGION_KEYS } from '../pilotRegion';
import { getWordPressSourceConfigBySourceKey } from '../../collectors/wordpress-content/config/registry';

describe('regions — registo declarativo real', () => {
  it('passa a validação estrutural', () => {
    expect(() => validateRegions(REGIONS)).not.toThrow();
  });

  it('todas as regiões do piloto existem no registo', () => {
    for (const key of PILOT_REGION_KEYS) {
      expect(getRegion(key).key).toBe(key);
    }
  });

  it('cada fonte WordPress declarada existe no registry WordPress e é da mesma cidade', () => {
    for (const region of REGIONS) {
      for (const sourceKey of region.sources) {
        if (sourceKey === GOOGLE_PLACES_SOURCE_KEY) continue;
        const config = getWordPressSourceConfigBySourceKey(sourceKey);
        expect(config, `${region.key} → ${sourceKey}`).not.toBeNull();
        expect(config!.region_metadata?.city).toBe(region.city);
        expect(config!.region_metadata?.state).toBe(region.state);
      }
    }
  });

  it('getRegion() falha explicitamente para uma chave desconhecida', () => {
    expect(() => getRegion('cidade_que_nao_existe')).toThrow(/não existe/);
  });
});

describe('regions — validateRegions() com registos sintéticos', () => {
  const base: RegionDefinition = {
    key: 'cidade_teste',
    city_label: 'Cidade Teste RJ',
    city: 'Cidade Teste',
    state: 'RJ',
    center: { lat: -22.9, lng: -42.0 },
    radius_m: 4000,
    sources: [GOOGLE_PLACES_SOURCE_KEY],
  };

  it('chave duplicada lança', () => {
    expect(() => validateRegions([base, { ...base }])).toThrow(/duplicada/);
  });

  it('chave fora de snake_case lança', () => {
    expect(() => validateRegions([{ ...base, key: 'Cidade-Teste' }])).toThrow(/inválida/);
  });

  it('coordenadas fora do intervalo lançam', () => {
    expect(() => validateRegions([{ ...base, center: { lat: -122.9, lng: -42 } }])).toThrow(/coordenadas/);
  });

  it('raio não positivo lança', () => {
    expect(() => validateRegions([{ ...base, radius_m: 0 }])).toThrow(/radius_m/);
  });

  it('rótulo vazio lança', () => {
    expect(() => validateRegions([{ ...base, city_label: '  ' }])).toThrow(/vazio/);
  });

  it('sources duplicadas lançam', () => {
    expect(() =>
      validateRegions([{ ...base, sources: [GOOGLE_PLACES_SOURCE_KEY, GOOGLE_PLACES_SOURCE_KEY] }]),
    ).toThrow(/duplicadas/);
  });
});

describe('regions — adicionar uma cidade = uma entrada', () => {
  it('uma entrada nova gera as 7 queries dessa cidade, sem tocar no código', () => {
    const nova: RegionDefinition = {
      key: 'cidade_nova',
      city_label: 'Cidade Nova RJ',
      city: 'Cidade Nova',
      state: 'RJ',
      center: { lat: -22.75, lng: -41.9 },
      radius_m: 5000,
      sources: [GOOGLE_PLACES_SOURCE_KEY],
    };
    const registo = [...REGIONS, nova];
    expect(() => validateRegions(registo)).not.toThrow();

    const queries = buildPilotQueries([nova]);
    expect(queries).toHaveLength(7);
    expect(queries.every((q) => q.region_key === 'cidade_nova')).toBe(true);
    expect(queries[0]!.query_text).toBe('teatro em Cidade Nova RJ');
  });

  it('acrescentar uma cidade ao registo não altera as queries do piloto', () => {
    expect(buildPilotQueries()).toHaveLength(PILOT_REGION_KEYS.length * 7);
  });
});
