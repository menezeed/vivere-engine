/**
 * Leituras de estado do staging (Codex r0, achado 2). BD falsa, sem rede.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertComplete, assertNoRunningRun, stagedCountsBySeries, READ_LIMIT } from '../fishStagingState';

type Call = unknown[];
/** Cada tabela devolve as linhas dadas; regista as chamadas. */
function fakeDb(tables: Record<string, unknown[]>, counts: Record<string, number | null> = {}) {
  const calls: Call[] = [];
  const db = {
    schema: (sc: string) => { calls.push(['schema', sc]); return db; },
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit']) b[m] = (...a: unknown[]) => { calls.push([t, m, ...a]); return b; };
      b['then'] = (res: (v: unknown) => unknown) => res({ data: tables[t] ?? [], count: t in counts ? counts[t] : (tables[t] ?? []).length, error: null });
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe('fishStagingState', () => {
  it('lê só as séries do plano, com limite explícito', async () => {
    const { db, calls } = fakeDb({
      raw_activity_items: [{ id: 'r1', source_item_id: 'series:a:wed:1030' }, { id: 'r2', source_item_id: 'series:a:wed:1030' }],
      activities_staging: [{ raw_activity_item_id: 'r1' }, { raw_activity_item_id: 'r2' }],
    });
    const c = await stagedCountsBySeries(db, 'fish', 'uk', ['series:a:wed:1030', 'series:b:thu:1030']);
    expect(c.get('series:a:wed:1030')).toBe(2);   // duplicado detectado (verificação depois da escrita)
    expect(c.get('series:b:thu:1030')).toBe(0);
    expect(calls).toContainEqual(['raw_activity_items', 'in', 'source_item_id', ['series:a:wed:1030', 'series:b:thu:1030']]);
    expect(calls).toContainEqual(['raw_activity_items', 'limit', READ_LIMIT]);
  });

  it('raw sem linha em activities_staging não conta como existente (é reinserido)', async () => {
    const { db } = fakeDb({ raw_activity_items: [{ id: 'r1', source_item_id: 'series:a:wed:1030' }], activities_staging: [] });
    expect((await stagedCountsBySeries(db, 'fish', 'uk', ['series:a:wed:1030'])).get('series:a:wed:1030')).toBe(0);
  });

  it('limite de leitura atingido → recusa (nunca corte silencioso)', async () => {
    const many = Array.from({ length: READ_LIMIT }, (_, i) => ({ id: `r${i}`, source_item_id: 'series:a:wed:1030' }));
    const { db } = fakeDb({ raw_activity_items: many });
    await expect(stagedCountsBySeries(db, 'fish', 'uk', ['series:a:wed:1030'])).rejects.toThrow(/incompleta/);
  });

  it('resposta truncada pelo servidor (count > linhas recebidas) → recusa, mesmo abaixo de READ_LIMIT (Codex r1, achado 2)', async () => {
    const one = [{ id: 'r1', source_item_id: 'series:a:wed:1030' }];
    await expect(stagedCountsBySeries(fakeDb({ raw_activity_items: one }, { raw_activity_items: 5 }).db, 'fish', 'uk', ['series:a:wed:1030']))
      .rejects.toThrow(/incompleta.*1 de 5/);
    await expect(stagedCountsBySeries(fakeDb({ raw_activity_items: one, activities_staging: [{ raw_activity_item_id: 'r1' }] }, { activities_staging: 3 }).db, 'fish', 'uk', ['series:a:wed:1030']))
      .rejects.toThrow(/activities_staging/);
    expect(() => assertComplete('t', null, 0)).toThrow(/sem contagem/);
    expect(() => assertComplete('t', 2, 2)).not.toThrow();
  });

  it('ingestion_run "running" da fonte → recusa (execução concorrente)', async () => {
    await expect(assertNoRunningRun(fakeDb({ ingestion_runs: [{ id: 'x' }] }).db, 'fish')).rejects.toThrow(/running/);
    await expect(assertNoRunningRun(fakeDb({ ingestion_runs: [] }).db, 'fish')).resolves.toBeUndefined();
  });

  it('nunca lê public.sources (o service_role não tem privilégios nessa tabela, migração 0019)', async () => {
    const { db, calls } = fakeDb({ raw_activity_items: [] });
    await stagedCountsBySeries(db, 'fish', 'uk', ['series:a:wed:1030']);
    await assertNoRunningRun(db, 'fish');
    expect(calls.some(c => c[0] === 'sources')).toBe(false);
  });
});
