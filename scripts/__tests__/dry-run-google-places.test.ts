/**
 * scripts/__tests__/dry-run-google-places.test.ts
 *
 * Mesmo princípio de ingest-google-places.test.ts — testa a resolução
 * de argv → productConfig efetivo, sem chamar a API real. Cobre
 * também o nível extra que este script tem (--product=), ausente no
 * ingest-google-places.ts.
 */

import { describe, it, expect } from 'vitest';
import { resolveDryRunArgs } from '../dry-run-google-places';
import type { GooglePlacesProductConfig } from '../../src/collectors/google-places/config/GooglePlacesProductConfig';

function makeConfig(productKey: string, regionKeys: string[]): GooglePlacesProductConfig {
  return {
    source_key: 'google_places',
    product_key: productKey,
    source_priority: 1,
    monthly_budget_usd: 10,
    hard_stop_enabled: true,
    alert_threshold_pct: 80,
    categories: [
      { key: 'teatro', query_kind: 'place_type', google_types: ['performing_arts_theater'] },
    ] as unknown as GooglePlacesProductConfig['categories'],
    regions: regionKeys.map((key, i) => ({
      key,
      display_label: key,
      lat: -23 - i,
      lng: -46 - i,
      radius_m: 2500,
    })),
  };
}

const AVAILABLE_PRODUCTS: Record<string, GooglePlacesProductConfig> = {
  'vivere-60-mais': makeConfig('vivere-60-mais', ['cabo_frio', 'araruama', 'sp_brooklin_pilot']),
  'targeted-er-lookup': makeConfig('targeted-er-lookup', ['cidade_a', 'cidade_x']),
};

describe('resolveDryRunArgs — --product e --region juntos', () => {
  it('sem argumentos, usa vivere-60-mais com TODAS as regiões (default)', () => {
    const result = resolveDryRunArgs(['node', 'dry-run-google-places.ts'], AVAILABLE_PRODUCTS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.productKey).toBe('vivere-60-mais');
      expect(result.result.productConfig.regions).toHaveLength(3);
    }
  });

  it('com --region=sp_brooklin_pilot, restringe a EXATAMENTE essa região (o bug real desta sessão)', () => {
    const result = resolveDryRunArgs(
      ['node', 'dry-run-google-places.ts', '--product=vivere-60-mais', '--region=sp_brooklin_pilot'],
      AVAILABLE_PRODUCTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.productConfig.regions).toHaveLength(1);
      expect(result.result.productConfig.regions[0]!.key).toBe('sp_brooklin_pilot');
    }
  });

  it('--product= troca corretamente de produto, e --region= filtra dentro DESSE produto', () => {
    const result = resolveDryRunArgs(
      ['node', 'dry-run-google-places.ts', '--product=targeted-er-lookup', '--region=cidade_x'],
      AVAILABLE_PRODUCTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.productKey).toBe('targeted-er-lookup');
      expect(result.result.productConfig.regions).toHaveLength(1);
      expect(result.result.productConfig.regions[0]!.key).toBe('cidade_x');
    }
  });

  it('--product= inexistente falha antes de sequer olhar para --region=', () => {
    const result = resolveDryRunArgs(
      ['node', 'dry-run-google-places.ts', '--product=produto_fantasma', '--region=sp_brooklin_pilot'],
      AVAILABLE_PRODUCTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.available).toEqual(['vivere-60-mais', 'targeted-er-lookup']);
    }
  });

  it('--region= válida para um produto mas não para outro é corretamente rejeitada', () => {
    // sp_brooklin_pilot existe em vivere-60-mais, não em targeted-er-lookup
    const result = resolveDryRunArgs(
      ['node', 'dry-run-google-places.ts', '--product=targeted-er-lookup', '--region=sp_brooklin_pilot'],
      AVAILABLE_PRODUCTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.available).toEqual(['cidade_a', 'cidade_x']);
    }
  });

  it('--limit= é lido corretamente em conjunto com --product e --region', () => {
    const result = resolveDryRunArgs(
      ['node', 'dry-run-google-places.ts', '--product=vivere-60-mais', '--region=araruama', '--limit=3'],
      AVAILABLE_PRODUCTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.limitQueries).toBe(3);
    }
  });
});
