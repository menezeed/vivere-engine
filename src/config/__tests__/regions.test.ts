import { describe, it, expect } from 'vitest';
import { REGIONS, GOOGLE_PLACES_SOURCE_KEY, NON_WORDPRESS_ACTIVITY_SOURCE_KEYS, DEFAULT_REGION_LOCALE, regionLocale, validateRegions, getRegion, requireGeo, type RegionDefinition } from '../regions';
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
        if (sourceKey === GOOGLE_PLACES_SOURCE_KEY || NON_WORDPRESS_ACTIVITY_SOURCE_KEYS.has(sourceKey)) continue;
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
    // Revisão r0 (BAIXO): exercitar mesmo um registo AMPLIADO e comparar as
    // queries completas do piloto (não só a contagem).
    const nova: RegionDefinition = {
      key: 'cidade_extra',
      city_label: 'Cidade Extra RJ',
      city: 'Cidade Extra',
      state: 'RJ',
      center: { lat: -22.7, lng: -41.95 },
      radius_m: 8000,
      sources: [GOOGLE_PLACES_SOURCE_KEY],
    };
    const ampliado = [...REGIONS, nova];
    expect(() => validateRegions(ampliado)).not.toThrow();
    const pilotoNoAmpliado = PILOT_REGION_KEYS.map((key) => getRegion(key, ampliado));
    expect(buildPilotQueries(pilotoNoAmpliado)).toEqual(buildPilotQueries());
    expect(buildPilotQueries(pilotoNoAmpliado).some((q) => q.region_key === 'cidade_extra')).toBe(false);
    expect(buildPilotQueries()).toHaveLength(PILOT_REGION_KEYS.length * 7);
  });
});

describe('regions — regiões sem centro confirmado (E5)', () => {
  const semCentro: RegionDefinition = {
    key: 'cidade_sem_centro',
    city_label: 'Cidade RJ',
    city: 'Cidade',
    state: 'RJ',
    center: null,
    radius_m: null,
    sources: ['prefeitura_x'],
  };

  it('Búzios e Rio das Ostras estão no registo SEM coordenadas e só com a fonte WordPress', () => {
    for (const [key, source] of [['buzios', 'prefeitura_buzios'], ['rio_das_ostras', 'prefeitura_rio_das_ostras']] as const) {
      const r = getRegion(key);
      expect(r.center).toBeNull();
      expect(r.radius_m).toBeNull();
      expect(r.sources).toEqual([source]);
      expect(() => requireGeo(r)).toThrow(/não tem centro confirmado/);
    }
  });

  it('região sem centro é válida se não usar Google Places', () => {
    expect(() => validateRegions([semCentro])).not.toThrow();
  });

  it('região sem centro com Google Places é recusada', () => {
    expect(() => validateRegions([{ ...semCentro, sources: [GOOGLE_PLACES_SOURCE_KEY] }])).toThrow(/sem centro confirmado/);
  });

  it('center e radius_m têm de estar ambos presentes ou ambos null', () => {
    expect(() => validateRegions([{ ...semCentro, radius_m: 4000 }])).toThrow(/inconsistentes/);
    expect(() => validateRegions([{ ...semCentro, center: { lat: -22.9, lng: -42 } }])).toThrow(/inconsistentes/);
  });

  it('requireGeo devolve centro e raio quando existem', () => {
    expect(requireGeo(getRegion('cabo_frio'))).toEqual({ center: { lat: -22.8894, lng: -42.0188 }, radius_m: 12000 });
  });
});

describe('regions — localização (piloto UK, U1)', () => {
  it('regiões sem country/locale/timezone ficam com a localização BR por omissão', () => {
    expect(regionLocale(getRegion('cabo_frio'))).toEqual(DEFAULT_REGION_LOCALE);
    expect(DEFAULT_REGION_LOCALE).toEqual({ country: 'BR', locale: 'pt-BR', timezone: 'America/Sao_Paulo' });
  });

  it('richmond_upon_thames: GB, en-GB, Europe/London, centro do ADR-0010, raio 8 km, fonte u3a', () => {
    const r = getRegion('richmond_upon_thames');
    expect(regionLocale(r)).toEqual({ country: 'GB', locale: 'en-GB', timezone: 'Europe/London' });
    expect(requireGeo(r)).toEqual({ center: { lat: 51.4613, lng: -0.3037 }, radius_m: 8000 });
    expect(r.sources).toEqual(['u3a_richmond']);
    expect(r.sources).not.toContain(GOOGLE_PLACES_SOURCE_KEY); // sem APIs pagas no piloto
  });

  const base: RegionDefinition = {
    key: 'x', city_label: 'X', city: 'X', state: 'X', center: null, radius_m: null, sources: [],
  };
  it('country, locale e timezone inválidos são recusados', () => {
    expect(() => validateRegions([{ ...base, country: 'gb' }])).toThrow(/country inválido/);
    expect(() => validateRegions([{ ...base, locale: 'english' }])).toThrow(/locale inválido/);
    expect(() => validateRegions([{ ...base, timezone: 'Europe/Nowhere' }])).toThrow(/timezone IANA inválido/);
    expect(() => validateRegions([{ ...base, country: 'GB', locale: 'en-GB', timezone: 'Europe/London' }])).not.toThrow();
  });
});
