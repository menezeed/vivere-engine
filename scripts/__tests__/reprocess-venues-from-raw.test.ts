/**
 * scripts/__tests__/reprocess-venues-from-raw.test.ts
 *
 * Testa resolveReprocessArgs — a única lógica não-trivial deste
 * script (resto é orquestração fina). Confirma: --region= obrigatório,
 * SourceConfigContract mínimo construído corretamente (não o
 * GooglePlacesProductConfig inteiro), e reaproveitamento de
 * resolveRegionFilter.
 */

import { describe, it, expect } from 'vitest';
import { resolveReprocessArgs } from '../reprocess-venues-from-raw';
import type { GooglePlacesProductConfig } from '../../src/collectors/google-places/config/GooglePlacesProductConfig';

const BASE_CONFIG: GooglePlacesProductConfig = {
  source_key: 'google_places',
  product_key: 'vivere-60-mais',
  source_priority: 1,
  monthly_budget_usd: 10,
  hard_stop_enabled: true,
  alert_threshold_pct: 80,
  categories: [
    { key: 'teatro', query_text: 'teatro', kind: 'place_type' },
  ],
  regions: [
    { key: 'cabo_frio', display_label: 'Cabo Frio RJ', lat: -22.8894, lng: -42.0188, radius_m: 12000 },
    { key: 'sp_brooklin_pilot', display_label: 'Brooklin, São Paulo', lat: -23.61011, lng: -46.686907, radius_m: 2500 },
  ],
};

describe('resolveReprocessArgs — --region= é obrigatório', () => {
  it('sem --region=, devolve ok:false com a lista de regiões disponíveis', () => {
    const result = resolveReprocessArgs(['node', 'reprocess-venues-from-raw.ts'], BASE_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.available).toEqual(['cabo_frio', 'sp_brooklin_pilot']);
      expect(result.error).toContain('obrigatório');
    }
  });
});

describe('resolveReprocessArgs — --region= válido', () => {
  it('constrói um SourceConfigContract MÍNIMO — não o GooglePlacesProductConfig inteiro', () => {
    const result = resolveReprocessArgs(
      ['node', 'reprocess-venues-from-raw.ts', '--region=sp_brooklin_pilot'],
      BASE_CONFIG,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { sourceConfig } = result.result;
      expect(sourceConfig.source_key).toBe('google_places');
      expect(sourceConfig.product_key).toBe('vivere-60-mais');
      expect(sourceConfig.regions).toHaveLength(1);
      expect(sourceConfig.regions![0]!.display_label).toBe('Brooklin, São Paulo');
      // Confirma explicitamente que campos exclusivos de
      // GooglePlacesProductConfig (nunca usados por reprocessVenuesFromRaw)
      // não fazem parte do objeto construído.
      expect((sourceConfig as unknown as Record<string, unknown>)['categories']).toBeUndefined();
      expect((sourceConfig as unknown as Record<string, unknown>)['monthly_budget_usd']).toBeUndefined();
    }
  });

  it('regionLabel vem do display_label da região selecionada, não do region_key', () => {
    const result = resolveReprocessArgs(
      ['node', 'reprocess-venues-from-raw.ts', '--region=sp_brooklin_pilot'],
      BASE_CONFIG,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.regionLabel).toBe('Brooklin, São Paulo');
      expect(result.result.regionKey).toBe('sp_brooklin_pilot');
    }
  });

  it('--dry-run é lido corretamente junto com --region=', () => {
    const result = resolveReprocessArgs(
      ['node', 'reprocess-venues-from-raw.ts', '--region=cabo_frio', '--dry-run'],
      BASE_CONFIG,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.dryRun).toBe(true);
    }
  });

  it('sem --dry-run, dryRun é false por omissão', () => {
    const result = resolveReprocessArgs(
      ['node', 'reprocess-venues-from-raw.ts', '--region=cabo_frio'],
      BASE_CONFIG,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.dryRun).toBe(false);
    }
  });
});

describe('resolveReprocessArgs — --region= inválido', () => {
  it('reaproveita resolveRegionFilter — mesma mensagem de erro e lista de disponíveis', () => {
    const result = resolveReprocessArgs(
      ['node', 'reprocess-venues-from-raw.ts', '--region=regiao_inexistente'],
      BASE_CONFIG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.available).toEqual(['cabo_frio', 'sp_brooklin_pilot']);
    }
  });
});
