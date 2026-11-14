/**
 * Regressão L3 — as queries do piloto Google Places (Cabo Frio e
 * Araruama) NÃO podem mudar quando as regiões passam a vir de um
 * registo declarativo.
 *
 * O snapshot em fixtures/pilot-queries.snapshot.json foi capturado a
 * partir do pilotRegion.ts ANTES da refactorização (origin/main
 * @7e71890), executando buildPilotQueries() e serializando
 * PILOT_REGIONS. Não regenerar este ficheiro para "fazer passar" o
 * teste: uma diferença aqui é uma mudança de comportamento.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildPilotQueries, PILOT_REGIONS } from '../pilotRegion';

const snapshot = JSON.parse(
  readFileSync(new URL('./fixtures/pilot-queries.snapshot.json', import.meta.url), 'utf8'),
) as { regions: unknown; queries: unknown[] };

describe('pilotRegion — regressão das queries do piloto', () => {
  it('buildPilotQueries() gera exactamente as mesmas 14 queries, pela mesma ordem', () => {
    const queries = buildPilotQueries();
    expect(queries).toHaveLength(14);
    expect(queries).toEqual(snapshot.queries);
  });

  it('PILOT_REGIONS mantém as mesmas chaves, centros e raios', () => {
    expect(PILOT_REGIONS).toEqual(snapshot.regions);
    expect(Object.keys(PILOT_REGIONS)).toEqual(['cabo_frio', 'araruama']);
  });
});
