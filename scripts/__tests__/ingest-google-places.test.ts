/**
 * scripts/__tests__/ingest-google-places.test.ts
 *
 * Testa exatamente o ponto onde os dois bugs reais desta sessão
 * aconteceram: a montagem da configuração efetiva a partir de argv.
 * Não chama a API real, não toca Supabase — resolveIngestArgs() é
 * pura. O guarda de entry-point em ingest-google-places.ts garante que
 * importar este módulo aqui não dispara main().
 */

import { describe, it, expect } from 'vitest';
import { resolveIngestArgs } from '../ingest-google-places';
import type { GooglePlacesProductConfig } from '../../src/collectors/google-places/config/GooglePlacesProductConfig';

const BASE_CONFIG: GooglePlacesProductConfig = {
  source_key: 'google_places',
  product_key: 'vivere-60-mais',
  source_priority: 1,
  monthly_budget_usd: 10,
  hard_stop_enabled: true,
  alert_threshold_pct: 80,
  categories: [
    { key: 'teatro', query_kind: 'place_type', google_types: ['performing_arts_theater'] },
  ] as unknown as GooglePlacesProductConfig['categories'],
  regions: [
    { key: 'cabo_frio', display_label: 'Cabo Frio RJ', lat: -22.8894, lng: -42.0188, radius_m: 12000 },
    { key: 'araruama', display_label: 'Araruama RJ', lat: -22.8717, lng: -42.3433, radius_m: 12000 },
    { key: 'sp_brooklin_pilot', display_label: 'Brooklin, São Paulo', lat: -23.61011, lng: -46.686907, radius_m: 2500 },
  ],
};

describe('resolveIngestArgs — o ponto exato onde os dois bugs reais aconteceram', () => {
  it('sem --region=, devolve TODAS as regiões (comportamento esperado, mas perigoso — main() deve avisar)', () => {
    const result = resolveIngestArgs(['node', 'ingest-google-places.ts'], BASE_CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.productConfig.regions).toHaveLength(3);
      expect(result.result.regionKey).toBeUndefined();
    }
  });

  it('com --region=sp_brooklin_pilot, restringe a EXATAMENTE essa região — não as 3', () => {
    const result = resolveIngestArgs(
      ['node', 'ingest-google-places.ts', '--region=sp_brooklin_pilot'],
      BASE_CONFIG,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.productConfig.regions).toHaveLength(1);
      expect(result.result.productConfig.regions[0]!.key).toBe('sp_brooklin_pilot');
    }
  });

  it('com --region=regiao_inexistente, ok:false com lista de disponíveis — sem instanciar nada', () => {
    const result = resolveIngestArgs(
      ['node', 'ingest-google-places.ts', '--region=regiao_inexistente'],
      BASE_CONFIG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.available).toEqual(['cabo_frio', 'araruama', 'sp_brooklin_pilot']);
    }
  });

  it('--dry-run e --limit= continuam a ser lidos corretamente junto com --region=', () => {
    const result = resolveIngestArgs(
      ['node', 'ingest-google-places.ts', '--region=araruama', '--dry-run', '--limit=2'],
      BASE_CONFIG,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.dryRun).toBe(true);
      expect(result.result.limitQueries).toBe(2);
      expect(result.result.productConfig.regions[0]!.key).toBe('araruama');
    }
  });
});
