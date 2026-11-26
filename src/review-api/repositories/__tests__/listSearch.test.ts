/**
 * Pesquisa nas listagens da Review API (20/11/2026).
 *
 * Antes, ActivityReviewRepository.list filtrava o título EM MEMÓRIA, depois
 * do .range(): a pesquisa só via a página actual e totalItems ignorava o
 * filtro. Agora o filtro vai para o PostgREST (ilike no embed !inner).
 * Os termos passam a ser literais (%, _ e \ escapados) em actividades e venues.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ActivityReviewRepository } from '../ActivityReviewRepository';
import { VenueReviewRepository } from '../VenueReviewRepository';
import { ilikeContains } from '../../types/listTypes';

type Call = [string, ...unknown[]];

/** Query builder falso: regista as chamadas e resolve com a resposta dada. */
function fakeDb(result: { data: unknown[]; count: number }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['schema', 'from', 'select', 'order', 'range', 'eq', 'ilike', 'in', 'not', 'or']) {
    builder[m] = (...args: unknown[]) => { calls.push([m, ...args]); return builder; };
  }
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve({ ...result, error: null });
  return { db: builder as unknown as SupabaseClient, calls };
}

const activityRow = (title: string) => ({
  id: '00000000-0000-4000-8000-000000000001', raw_activity_item_id: 'r1', product_key: 'vivere-60-mais',
  proposal_status: 'pending', venue_resolution_status: 'resolved', created_at: '2026-11-20T00:00:00Z',
  raw_activity_items: { title, source_key: 's', occurrences: null },
});

describe('ilikeContains', () => {
  it.each([
    ['corrida', '%corrida%'],
    ['50%', '%50\\%%'],
    ['a_b', '%a\\_b%'],
    ['c:\\x', '%c:\\\\x%'],
    ['*', '%_%'],            // * → _ (r0 do #37): o PostgREST tornaria * em %
    ['a*b_', '%a_b\\_%'],
  ])('%s → %s', (term, expected) => {
    expect(ilikeContains(term)).toBe(expected);
  });
});

describe('ActivityReviewRepository.list — pesquisa por título no servidor', () => {
  it('envia ilike em raw_activity_items.title e não volta a filtrar em memória', async () => {
    // O servidor é a autoridade (filtrou e contou 37 em todas as páginas).
    // A linha devolvida NÃO contém o termo: se o filtro em memória voltar,
    // é descartada e o teste falha (revisão r0 do #37).
    const { db, calls } = fakeDb({ data: [activityRow('Passeio no Portinho')], count: 37 });
    const res = await new ActivityReviewRepository(db).list({ search: 'corrida', page: 2, pageSize: 20 });

    expect(calls).toContainEqual(['ilike', 'raw_activity_items.title', '%corrida%']);
    expect(calls).toContainEqual(['range', 20, 39]);
    expect(res.items).toHaveLength(1);
    expect(res.totalItems).toBe(37);
    expect(res.totalPages).toBe(2);
  });

  it('o termo é literal (curingas escapados)', async () => {
    const { db, calls } = fakeDb({ data: [], count: 0 });
    await new ActivityReviewRepository(db).list({ search: '100%_' });
    expect(calls).toContainEqual(['ilike', 'raw_activity_items.title', '%100\\%\\_%']);
  });

  it('sem pesquisa não há ilike', async () => {
    const { db, calls } = fakeDb({ data: [], count: 0 });
    await new ActivityReviewRepository(db).list({});
    expect(calls.some(([m]) => m === 'ilike')).toBe(false);
  });
});

describe('ordenação estável para a paginação (Issue #60)', () => {
  // As 133 actividades UK do staging têm só 3 valores de created_at: sem
  // desempate, o OFFSET podia repetir ou saltar linhas entre as páginas 1..7.
  it('actividades: ordena pela coluna pedida e depois por id', async () => {
    const { db, calls } = fakeDb({ data: [], count: 133 });
    await new ActivityReviewRepository(db).list({ page: 7, pageSize: 20 });
    const orders = calls.filter(([m]) => m === 'order');
    expect(orders).toEqual([['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: true }]]);
    expect(calls).toContainEqual(['range', 120, 139]);
  });

  it('venues: ordena pela coluna pedida e depois por id', async () => {
    const { db, calls } = fakeDb({ data: [], count: 26 });
    await new VenueReviewRepository(db).list({ sort: 'name', order: 'asc' });
    const orders = calls.filter(([m]) => m === 'order');
    expect(orders.at(-1)).toEqual(['order', 'id', { ascending: true }]);
    expect(orders).toHaveLength(2);
  });
});

describe('filtro de elegibilidade no servidor (Issue #62)', () => {
  const F = { source_key: 'u3a_richmond', ids: ['group:1', 'event:2'], urls: ['https://x.uk/g1/', 'https://x.uk/e2/'] };

  it('in: mesma chave da classificação (fonte + id + URL)', async () => {
    const { db, calls } = fakeDb({ data: [], count: 7 });
    await new ActivityReviewRepository(db).list({ page: 1, pageSize: 20, source_item_ids: { mode: 'in', ...F } });
    expect(calls).toContainEqual(['eq', 'raw_activity_items.source_key', 'u3a_richmond']);
    expect(calls).toContainEqual(['in', 'raw_activity_items.source_item_id', ['group:1', 'event:2']]);
    expect(calls).toContainEqual(['in', 'raw_activity_items.external_url', ['https://x.uk/g1/', 'https://x.uk/e2/']]);
  });

  it('not_in: exclui só as linhas que casam (outra fonte ou URL divergente ficam em not_audited)', async () => {
    const { db, calls } = fakeDb({ data: [], count: 0 });
    await new ActivityReviewRepository(db).list({ source_item_ids: { mode: 'not_in', ...F } });
    expect(calls).toContainEqual(['or',
      'source_key.neq."u3a_richmond",source_item_id.not.in.("group:1","event:2"),external_url.not.in.("https://x.uk/g1/","https://x.uk/e2/")',
      { referencedTable: 'raw_activity_items' }]);
    expect(calls.some(([m]) => m === 'not')).toBe(false);
  });

  it('in vazio → resposta vazia sem consultar a base', async () => {
    const { db, calls } = fakeDb({ data: [activityRow('x')], count: 1 });
    const res = await new ActivityReviewRepository(db).list({ source_item_ids: { mode: 'in', source_key: 's', ids: [], urls: [] } });
    expect(res.totalItems).toBe(0);
    expect(res.items).toEqual([]);
    expect(calls.some(([m]) => m === 'in')).toBe(false);
  });
});

describe('VenueReviewRepository.list — termos literais', () => {
  it('name e city com curingas escapados', async () => {
    const { db, calls } = fakeDb({ data: [], count: 0 });
    await new VenueReviewRepository(db).list({ search: 'a_b', city: '50%' });
    expect(calls).toContainEqual(['ilike', 'name', '%a\\_b%']);
    expect(calls).toContainEqual(['ilike', 'city', '%50\\%%']);
  });
});
