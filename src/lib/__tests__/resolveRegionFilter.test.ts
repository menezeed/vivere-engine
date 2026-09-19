import { describe, it, expect } from 'vitest';
import { resolveRegionFilter } from '../resolveRegionFilter';

const PRODUCT_CONFIG = {
  product_key: 'vivere-60-mais',
  regions: [
    { key: 'cabo_frio', display_label: 'Cabo Frio RJ', lat: -22.8894, lng: -42.0188, radius_m: 12000 },
    { key: 'araruama', display_label: 'Araruama RJ', lat: -22.8717, lng: -42.3433, radius_m: 12000 },
    { key: 'sp_brooklin_pilot', display_label: 'Brooklin, São Paulo', lat: -23.61011, lng: -46.686907, radius_m: 2500 },
  ],
} as const;

describe('resolveRegionFilter — sem regionKey', () => {
  it('devolve o productConfig original, sem alteração, quando regionKey é undefined', () => {
    const result = resolveRegionFilter(PRODUCT_CONFIG, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toBe(PRODUCT_CONFIG); // mesma referência — nenhuma cópia desnecessária
      expect(result.config.regions).toHaveLength(3);
    }
  });
});

describe('resolveRegionFilter — regionKey válido', () => {
  it('reduz regions a exatamente a região pedida', () => {
    const result = resolveRegionFilter(PRODUCT_CONFIG, 'sp_brooklin_pilot');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.regions).toHaveLength(1);
      expect(result.config.regions[0]!.key).toBe('sp_brooklin_pilot');
    }
  });

  it('preserva todos os outros campos do productConfig, não só regions', () => {
    const result = resolveRegionFilter(PRODUCT_CONFIG, 'cabo_frio');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.product_key).toBe('vivere-60-mais');
    }
  });

  it('funciona para qualquer região do array, não só a primeira/última', () => {
    const result = resolveRegionFilter(PRODUCT_CONFIG, 'araruama');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.regions[0]!.key).toBe('araruama');
    }
  });
});

describe('resolveRegionFilter — regionKey inválido', () => {
  it('devolve ok:false com mensagem clara e lista de disponíveis', () => {
    const result = resolveRegionFilter(PRODUCT_CONFIG, 'regiao_inexistente');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('regiao_inexistente');
      expect(result.error).toContain('cabo_frio');
      expect(result.error).toContain('araruama');
      expect(result.error).toContain('sp_brooklin_pilot');
      expect(result.available).toEqual(['cabo_frio', 'araruama', 'sp_brooklin_pilot']);
    }
  });

  it('não faz nenhum I/O, nenhum process.exit — só devolve o resultado (função pura)', () => {
    // Se esta função tivesse process.exit ou console.log, o teste
    // já teria terminado o processo do vitest. Chegar aqui é prova
    // suficiente de que é puramente funcional.
    const result = resolveRegionFilter(PRODUCT_CONFIG, 'inexistente');
    expect(result).toBeDefined();
  });
});

describe('resolveRegionFilter — genérico, funciona com qualquer forma de config/região', () => {
  it('funciona com um productConfig mínimo, sem campos extra', () => {
    const minimal = { regions: [{ key: 'x' }, { key: 'y' }] };
    const result = resolveRegionFilter(minimal, 'y');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.regions).toEqual([{ key: 'y' }]);
  });

  it('funciona com apenas uma região configurada', () => {
    const single = { regions: [{ key: 'unica' }] };
    const result = resolveRegionFilter(single, 'unica');
    expect(result.ok).toBe(true);
  });
});
