/**
 * src/publishing/__tests__/PublishableActivityRepository.humanReviewGate.test.ts
 *
 * Activity 13/26, Human Review Publication Gate, 2026-09-30.
 *
 * Antes desta correcção, findUnpublished()/findDirty() só exigiam
 * venue_resolution_status + promoted_activity_id — nenhuma decisão humana
 * sobre o CONTEÚDO da actividade (título, recorrência, ocorrências) era
 * exigida. Confirmado por medição real: 18 actividades elegíveis pelo
 * gate antigo, 0 com proposal_status='promoted'.
 *
 * Este ficheiro usa um mock que SIMULA filtragem real (ao contrário do
 * mock em PublishableActivityRepository.enrichWithPublicVenueIds.test.ts,
 * que é puramente estático) — necessário para provar comportamento
 * black-box por cenário, não só construção de query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PublishableActivityRepository } from '../repositories/impl/PublishableActivityRepository.js';

vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

interface FakeRow {
  id: string;
  product_key: string;
  proposal_status: string;
  venue_resolution_status: string;
  promoted_activity_id: string | null;
  resolved_venue_staging_id: string | null;
  recurrence_type: string | null;
  recurrence_days: number[] | null;
  recurrence_time: string | null;
  raw_activity_items: Record<string, unknown>;
}

function makeRow(overrides: Partial<FakeRow>): FakeRow {
  return {
    id: 'staging-1',
    product_key: 'vivere-60-mais',
    proposal_status: 'pending_review',
    venue_resolution_status: 'matched',
    promoted_activity_id: null,
    resolved_venue_staging_id: null,
    recurrence_type: null,
    recurrence_days: null,
    recurrence_time: null,
    raw_activity_items: {
      source_key: 'prefeitura_cabo_frio',
      title: 'Actividade de teste',
      description: null,
      occurrences: [{ date: '2026-07-30', time: null, end_date: null, end_time: null }],
      image_url: null,
      external_url: null,
      contact_phone: null,
      collected_at: '2026-06-01T00:00:00Z',
    },
    ...overrides,
  };
}

type Filter = { col: string; op: 'eq' | 'in' | 'is' | 'not_is'; value: unknown };

/**
 * Mock que SIMULA filtragem real: cada .eq/.in/.is/.not acumula uma
 * condição; no `then`, as condições são aplicadas ao array completo.
 * Também expõe os filtros capturados para provar a construção exacta
 * da query (critério alternativo do briefing, quando aplicável).
 */
function makeFilteringMockDb(allRows: FakeRow[]): { db: SupabaseClient; capturedFilters: Filter[] } {
  const capturedFilters: Filter[] = [];

  function applyFilters(rows: FakeRow[], filters: Filter[]): FakeRow[] {
    return rows.filter((row) => {
      for (const f of filters) {
        const actual = (row as unknown as Record<string, unknown>)[f.col];
        if (f.op === 'eq' && actual !== f.value) return false;
        if (f.op === 'in' && !(f.value as unknown[]).includes(actual)) return false;
        if (f.op === 'is' && f.value === null && actual !== null) return false;
        if (f.op === 'not_is' && f.value === null && actual === null) return false;
      }
      return true;
    });
  }

  function chainable(filters: Filter[]): Record<string, unknown> {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, value: unknown) => {
        const next = [...filters, { col, op: 'eq' as const, value }];
        capturedFilters.push({ col, op: 'eq', value });
        return chainable(next);
      },
      in: (col: string, value: unknown) => {
        const next = [...filters, { col, op: 'in' as const, value }];
        capturedFilters.push({ col, op: 'in', value });
        return chainable(next);
      },
      is: (col: string, value: unknown) => {
        const next = [...filters, { col, op: 'is' as const, value }];
        capturedFilters.push({ col, op: 'is', value });
        return chainable(next);
      },
      not: (col: string, _opName: string, value: unknown) => {
        const next = [...filters, { col, op: 'not_is' as const, value }];
        capturedFilters.push({ col, op: 'not_is', value });
        return chainable(next);
      },
      then: (resolve: (v: unknown) => void) => {
        resolve({ data: applyFilters(allRows, filters), error: null });
      },
    };
    return builder;
  }

  const db = {
    schema: () => ({
      from: (table: string) => {
        if (table === 'activities_staging') return chainable([]);
        if (table === 'venues_staging') return { select: () => ({ in: () => ({ not: () => ({ data: [] }) }) }) };
        throw new Error(`makeFilteringMockDb: tabela inesperada "${table}"`);
      },
    }),
  } as unknown as SupabaseClient;

  return { db, capturedFilters };
}

describe('PublishableActivityRepository — Activity 13 Human Review Publication Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('A. findUnpublished — promoted + matched → INCLUÍDA', async () => {
    const row = makeRow({ id: 'a', proposal_status: 'promoted', venue_resolution_status: 'matched' });
    const { db } = makeFilteringMockDb([row]);
    const repo = new PublishableActivityRepository(db);
    const result = await repo.findUnpublished('vivere-60-mais');
    expect(result.map((r) => r.stagingId)).toEqual(['a']);
  });

  it('B. findUnpublished — promoted + proposed_new → INCLUÍDA', async () => {
    const row = makeRow({ id: 'b', proposal_status: 'promoted', venue_resolution_status: 'proposed_new' });
    const { db } = makeFilteringMockDb([row]);
    const repo = new PublishableActivityRepository(db);
    const result = await repo.findUnpublished('vivere-60-mais');
    expect(result.map((r) => r.stagingId)).toEqual(['b']);
  });

  it('C. findUnpublished — pending_review + matched → EXCLUÍDA', async () => {
    const row = makeRow({ id: 'c', proposal_status: 'pending_review', venue_resolution_status: 'matched' });
    const { db } = makeFilteringMockDb([row]);
    const repo = new PublishableActivityRepository(db);
    const result = await repo.findUnpublished('vivere-60-mais');
    expect(result).toHaveLength(0);
  });

  it('D. findUnpublished — pending_review + proposed_new → EXCLUÍDA', async () => {
    const row = makeRow({ id: 'd', proposal_status: 'pending_review', venue_resolution_status: 'proposed_new' });
    const { db } = makeFilteringMockDb([row]);
    const repo = new PublishableActivityRepository(db);
    const result = await repo.findUnpublished('vivere-60-mais');
    expect(result).toHaveLength(0);
  });

  it('E. findUnpublished — approved mas não promoted → EXCLUÍDA', async () => {
    const row = makeRow({ id: 'e', proposal_status: 'approved', venue_resolution_status: 'matched' });
    const { db } = makeFilteringMockDb([row]);
    const repo = new PublishableActivityRepository(db);
    const result = await repo.findUnpublished('vivere-60-mais');
    expect(result).toHaveLength(0);
  });

  it('F. findDirty — promoted + venue válido + já publicada → INCLUÍDA', async () => {
    const row = makeRow({
      id: 'f', proposal_status: 'promoted', venue_resolution_status: 'matched',
      promoted_activity_id: 'public-activity-xyz',
    });
    const { db } = makeFilteringMockDb([row]);
    const repo = new PublishableActivityRepository(db);
    const result = await repo.findDirty('vivere-60-mais');
    expect(result.map((r) => r.stagingId)).toEqual(['f']);
  });

  it('G. findDirty — pending_review → EXCLUÍDA', async () => {
    const row = makeRow({
      id: 'g', proposal_status: 'pending_review', venue_resolution_status: 'matched',
      promoted_activity_id: 'public-activity-xyz',
    });
    const { db } = makeFilteringMockDb([row]);
    const repo = new PublishableActivityRepository(db);
    const result = await repo.findDirty('vivere-60-mais');
    expect(result).toHaveLength(0);
  });

  it('H. findDirty — approved mas não promoted → EXCLUÍDA', async () => {
    const row = makeRow({
      id: 'h', proposal_status: 'approved', venue_resolution_status: 'matched',
      promoted_activity_id: 'public-activity-xyz',
    });
    const { db } = makeFilteringMockDb([row]);
    const repo = new PublishableActivityRepository(db);
    const result = await repo.findDirty('vivere-60-mais');
    expect(result).toHaveLength(0);
  });

  it('construção de query — findUnpublished contém exactamente proposal_status=promoted', async () => {
    const { db, capturedFilters } = makeFilteringMockDb([]);
    const repo = new PublishableActivityRepository(db);
    await repo.findUnpublished('vivere-60-mais');
    expect(capturedFilters).toContainEqual({ col: 'proposal_status', op: 'eq', value: 'promoted' });
  });

  it('construção de query — findDirty contém exactamente proposal_status=promoted', async () => {
    const { db, capturedFilters } = makeFilteringMockDb([]);
    const repo = new PublishableActivityRepository(db);
    await repo.findDirty('vivere-60-mais');
    expect(capturedFilters).toContainEqual({ col: 'proposal_status', op: 'eq', value: 'promoted' });
  });

  it('múltiplas actividades — só as promoted+venue-válida atravessam o gate', async () => {
    const rows = [
      makeRow({ id: 'keep-1', proposal_status: 'promoted', venue_resolution_status: 'matched' }),
      makeRow({ id: 'drop-pending', proposal_status: 'pending_review', venue_resolution_status: 'matched' }),
      makeRow({ id: 'drop-approved', proposal_status: 'approved', venue_resolution_status: 'proposed_new' }),
      makeRow({ id: 'keep-2', proposal_status: 'promoted', venue_resolution_status: 'proposed_new' }),
      makeRow({ id: 'drop-rejected', proposal_status: 'rejected', venue_resolution_status: 'matched' }),
    ];
    const { db } = makeFilteringMockDb(rows);
    const repo = new PublishableActivityRepository(db);
    const result = await repo.findUnpublished('vivere-60-mais');
    expect(result.map((r) => r.stagingId).sort()).toEqual(['keep-1', 'keep-2']);
  });
});
