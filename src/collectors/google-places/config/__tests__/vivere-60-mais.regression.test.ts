/**
 * Regressão — a configuração Google Places do Vivere 60+ (regiões e
 * queries geradas) não pode mudar quando as regiões passam a vir do
 * registo declarativo src/config/regions.ts.
 *
 * O snapshot foi capturado ANTES da unificação, a partir de
 * VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG e buildQueriesForProduct().
 * Não regenerar para "fazer passar": uma diferença é uma mudança de
 * comportamento (8 regiões x 7 categorias = 56 queries).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG } from '../vivere-60-mais';
import { buildQueriesForProduct } from '../GooglePlacesProductConfig';

const snapshot = JSON.parse(
  readFileSync(new URL('./fixtures/vivere-60-mais-queries.snapshot.json', import.meta.url), 'utf8'),
) as { regions: unknown[]; queries: unknown[] };

describe('vivere-60-mais — regressão das regiões e queries Google Places', () => {
  it('as regiões mantêm chave, rótulo, centro e raio, pela mesma ordem', () => {
    expect(VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG.regions).toEqual(snapshot.regions);
  });

  it('buildQueriesForProduct() gera exactamente as mesmas 56 queries', () => {
    const queries = buildQueriesForProduct(VIVERE_60_MAIS_GOOGLE_PLACES_CONFIG);
    expect(queries).toHaveLength(56);
    expect(queries).toEqual(snapshot.queries);
  });
});
