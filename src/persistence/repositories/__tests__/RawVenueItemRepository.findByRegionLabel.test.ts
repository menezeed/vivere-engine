/**
 * src/persistence/repositories/__tests__/RawVenueItemRepository.findByRegionLabel.test.ts
 *
 * Confirma o ponto central da correção de desenho desta sessão:
 * a leitura da Camada A é por source_key + source_region_label —
 * NUNCA por product_key, que não existe em raw_venue_items.
 */

import { describe, it, expect, vi } from 'vitest';
import { RawVenueItemRepository } from '../RawVenueItemRepository';

function makeSelectChainDb(returnedRows: object[] = []) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq']) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  builder.then = (resolve: (v: { data: object[]; error: null }) => void) => resolve({ data: returnedRows, error: null });
  const from = vi.fn().mockReturnValue(builder);
  const schema = vi.fn().mockReturnValue({ from });
  return { schema, from, calls };
}

const SAMPLE_ROW = {
  id: 'raw-uuid-1',
  source_key: 'google_places',
  source_item_id: 'ChIJ_brooklin_1',
  collected_at: '2026-07-17T10:00:00Z',
  name: 'Teatro Claro MAIS SP',
  address: 'R. Olimpíadas, 360',
  lat: -23.5989,
  lng: -46.6858,
  phone: null,
  website: null,
  opening_hours_raw: null,
  image_url: null,
  source_category_hint: 'teatro',
  source_query_text: 'teatro em Brooklin, São Paulo',
  source_query_kind: 'place_type',
  source_region_label: 'Brooklin, São Paulo',
  google_types: ['performing_arts_theater'],
  google_business_status: 'OPERATIONAL',
  raw_payload: { id: 'ChIJ_brooklin_1' },
};

describe('RawVenueItemRepository.findByRegionLabel', () => {
  it('filtra por source_key + source_region_label — NUNCA por product_key', async () => {
    const db = makeSelectChainDb([SAMPLE_ROW]);
    const repo = new RawVenueItemRepository(db as never);

    await repo.findByRegionLabel('google_places', 'Brooklin, São Paulo');

    const eqCalls = db.calls.filter((c) => c.method === 'eq');
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['source_key', 'google_places'] });
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['source_region_label', 'Brooklin, São Paulo'] });
    // Confirma explicitamente que nenhuma chamada .eq() usa 'product_key'
    // — coluna que não existe em raw_venue_items.
    expect(eqCalls.some((c) => c.args[0] === 'product_key')).toBe(false);
  });

  it('reconstrói RawVenueItem e PersistedRawVenueItem a partir da mesma row', async () => {
    const db = makeSelectChainDb([SAMPLE_ROW]);
    const repo = new RawVenueItemRepository(db as never);

    const result = await repo.findByRegionLabel('google_places', 'Brooklin, São Paulo');

    expect(result).toHaveLength(1);
    expect(result[0]!.persisted).toEqual({ id: 'raw-uuid-1', source_item_id: 'ChIJ_brooklin_1' });
    expect(result[0]!.item.name).toBe('Teatro Claro MAIS SP');
    expect(result[0]!.item.lat).toBe(-23.5989);
    expect(result[0]!.item.source_region_label).toBe('Brooklin, São Paulo');
    expect(result[0]!.item.google_types).toEqual(['performing_arts_theater']);
    // 'id' e 'ingestion_run_id' NUNCA fazem parte do RawVenueItem reconstruído
    expect((result[0]!.item as unknown as Record<string, unknown>)['id']).toBeUndefined();
  });

  it('devolve lista vazia quando não há resultados, sem lançar', async () => {
    const db = makeSelectChainDb([]);
    const repo = new RawVenueItemRepository(db as never);

    const result = await repo.findByRegionLabel('google_places', 'Região Sem Dados');
    expect(result).toEqual([]);
  });

  it('lança com mensagem clara quando o banco retorna erro', async () => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq']) {
      builder[method] = vi.fn().mockReturnValue(builder);
    }
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'RLS violation' } });
    const from = vi.fn().mockReturnValue(builder);
    const schema = vi.fn().mockReturnValue({ from });

    const repo = new RawVenueItemRepository({ schema } as never);
    await expect(repo.findByRegionLabel('google_places', 'Brooklin, São Paulo')).rejects.toThrow('RLS violation');
  });

  it('nunca chama insertBatch/upsert — findByRegionLabel é só leitura', async () => {
    const db = makeSelectChainDb([SAMPLE_ROW]);
    const repo = new RawVenueItemRepository(db as never);

    await repo.findByRegionLabel('google_places', 'Brooklin, São Paulo');

    const builder = db.from.mock.results[0]!.value as Record<string, unknown>;
    expect(builder.upsert).toBeUndefined();
  });
});
