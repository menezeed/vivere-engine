import { describe, it, expect, vi } from 'vitest';
import { RawVenueItemRepository } from '../RawVenueItemRepository';
import { RawActivityItemRepository } from '../RawActivityItemRepository';
import { VenueStagingRepository } from '../VenueStagingRepository';
import { ActivityStagingRepository } from '../ActivityStagingRepository';
import type { RawVenueItem } from '../../../types/RawVenueItem';
import type { RawActivityItem } from '../../../types/RawActivityItem';
import type { FilteredVenueItem } from '../../../pipeline/stages/00-filter-venue/index';

function makeRawVenue(overrides: Partial<RawVenueItem> = {}): RawVenueItem {
  return {
    source_key: 'google_places',
    source_item_id: 'ChIJ_test_001',
    collected_at: '2026-06-30T12:00:00Z',
    name: 'Teatro Municipal de Cabo Frio',
    address: 'R. Teste, 1 - Cabo Frio',
    lat: -22.88,
    lng: -42.01,
    phone: null,
    website: null,
    opening_hours_raw: null,
    image_url: null,
    source_category_hint: 'teatro',
    source_query_text: 'teatro em Cabo Frio RJ',
    source_query_kind: 'place_type',
    google_types: ['performing_arts_theater'],
    google_business_status: 'OPERATIONAL',
    raw_payload: { id: 'ChIJ_test_001' },
    ...overrides,
  };
}

function makeRawActivity(overrides: Partial<RawActivityItem> = {}): RawActivityItem {
  return {
    source_key: 'prefeitura_cabo_frio',
    source_item_id: 'post_110155',
    collected_at: '2026-06-30T12:00:00Z',
    title: 'Yoga no Forte',
    description: null,
    raw_category_text: null,
    occurrences: [{ date: '2026-06-28', time: '07:00', end_date: null, end_time: '08:00' }],
    recurrence_text_hint: null,
    venue_mention: { raw_text: 'Canto do Forte', raw_address_text: null, confidence_hint: 'explicit_name' },
    price_text: null,
    is_free_hint: true,
    image_url: null,
    external_url: 'https://noticias.cabofrio.rj.gov.br/yoga',
    contact_phone: null,
    contact_email: null,
    language: 'pt',
    raw_payload: { extraction_method: 'structured_block' },
    ...overrides,
  };
}

function makeUpsertDb(returnedRows: object[] = []) {
  const select = vi.fn().mockResolvedValue({ data: returnedRows, error: null });
  const upsert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ upsert });
  const schema = vi.fn().mockReturnValue({ from });
  return { schema, from, upsert, select };
}

// ─── RawVenueItemRepository ───────────────────────────────────

describe('RawVenueItemRepository.insertBatch', () => {
  it('retorna lista vazia quando não há itens', async () => {
    const db = makeUpsertDb();
    const repo = new RawVenueItemRepository(db as never);
    const result = await repo.insertBatch([], 'run-id');
    expect(result).toHaveLength(0);
    expect(db.schema).not.toHaveBeenCalled();
  });

  it('mapeia source_item_id para o id retornado pelo banco', async () => {
    const db = makeUpsertDb([{ id: 'raw-venue-uuid', source_item_id: 'ChIJ_test_001' }]);
    const repo = new RawVenueItemRepository(db as never);

    const result = await repo.insertBatch([makeRawVenue()], 'run-id');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'raw-venue-uuid', source_item_id: 'ChIJ_test_001' });
  });

  it('usa onConflict com ignoreDuplicates=true — nunca ON CONFLICT DO UPDATE', async () => {
    const db = makeUpsertDb([{ id: 'raw-venue-uuid', source_item_id: 'ChIJ_test_001' }]);
    const repo = new RawVenueItemRepository(db as never);

    await repo.insertBatch([makeRawVenue()], 'run-id');

    expect(db.upsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ignoreDuplicates: true }),
    );
  });

  it('lança quando o banco retorna erro', async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS violation' } });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });
    const schema = vi.fn().mockReturnValue({ from });

    const repo = new RawVenueItemRepository({ schema } as never);
    await expect(repo.insertBatch([makeRawVenue()], 'run-id')).rejects.toThrow('RLS violation');
  });
});

// ─── RawActivityItemRepository ───────────────────────────────

describe('RawActivityItemRepository.insertBatch', () => {
  it('serializa venue_mention como colunas planas (não JSONB embutido)', async () => {
    const db = makeUpsertDb([{ id: 'raw-act-uuid', source_item_id: 'post_110155' }]);
    const repo = new RawActivityItemRepository(db as never);

    await repo.insertBatch([makeRawActivity()], 'run-id');

    const [rows] = db.upsert.mock.calls[0] as [object[]];
    const row = rows[0] as Record<string, unknown>;

    // venue_mention deve ser serializado como colunas separadas
    expect(row['venue_mention_raw_text']).toBe('Canto do Forte');
    expect(row['venue_mention_confidence_hint']).toBe('explicit_name');
    // nunca como objeto embutido
    expect(row['venue_mention']).toBeUndefined();
  });

  it('serializa occurrences como JSON string para JSONB', async () => {
    const db = makeUpsertDb([{ id: 'raw-act-uuid', source_item_id: 'post_110155' }]);
    const repo = new RawActivityItemRepository(db as never);

    await repo.insertBatch([makeRawActivity()], 'run-id');

    const [rows] = db.upsert.mock.calls[0] as [object[]];
    const row = rows[0] as Record<string, unknown>;

    expect(typeof row['occurrences']).toBe('string');
    const parsed = JSON.parse(row['occurrences'] as string);
    expect(parsed[0]).toMatchObject({ date: '2026-06-28', time: '07:00' });
  });

  it('mapeia venue_mention=null quando a atividade não tem venue', async () => {
    const db = makeUpsertDb([{ id: 'raw-act-uuid', source_item_id: 'post_sem_venue' }]);
    const repo = new RawActivityItemRepository(db as never);
    const activity = makeRawActivity({ source_item_id: 'post_sem_venue', venue_mention: null });

    await repo.insertBatch([activity], 'run-id');

    const [rows] = db.upsert.mock.calls[0] as [object[]];
    const row = rows[0] as Record<string, unknown>;
    expect(row['venue_mention_raw_text']).toBeNull();
    expect(row['venue_mention_confidence_hint']).toBeNull();
  });
});

// ─── VenueStagingRepository ──────────────────────────────────

describe('VenueStagingRepository.insertBatch', () => {
  function makeFiltered(decision: string, sourceItemId: string): FilteredVenueItem<string, string> {
    return {
      item: makeRawVenue({ source_item_id: sourceItemId }),
      filter: {
        decision,
        matches: [],
        decisive_layer: 'accept',
        reasoning: '',
      },
    } as FilteredVenueItem<string, string>;
  }

  it('NUNCA persiste itens com decisão rejected', async () => {
    const db = makeUpsertDb([]);
    const repo = new VenueStagingRepository(db as never);

    await repo.insertBatch(
      [makeFiltered('rejected', 'ChIJ_001')],
      [{ id: 'raw-uuid', source_item_id: 'ChIJ_001' }],
      'vivere-60-mais',
    );

    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('persiste itens accepted e needs_review', async () => {
    const db = makeUpsertDb([{ id: 'staging-uuid' }, { id: 'staging-uuid-2' }]);
    const repo = new VenueStagingRepository(db as never);

    const count = await repo.insertBatch(
      [makeFiltered('accepted', 'ChIJ_001'), makeFiltered('needs_review', 'ChIJ_002')],
      [
        { id: 'raw-1', source_item_id: 'ChIJ_001' },
        { id: 'raw-2', source_item_id: 'ChIJ_002' },
      ],
      'vivere-60-mais',
    );

    expect(db.upsert).toHaveBeenCalled();
    expect(count).toBe(2);
  });

  it('ignora item sem raw_venue_item_id correspondente (conflito de idempotência)', async () => {
    const db = makeUpsertDb([]);
    const repo = new VenueStagingRepository(db as never);

    // filteredItems tem ChIJ_001, mas persistedRaw está vazio (item já existia)
    await repo.insertBatch(
      [makeFiltered('accepted', 'ChIJ_001')],
      [],  // sem raw persistido
      'vivere-60-mais',
    );

    // Nenhuma linha vai para o banco — não tem FK para referenciar
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('insere com proposal_status = pending_review sempre', async () => {
    const db = makeUpsertDb([{ id: 'staging-uuid' }]);
    const repo = new VenueStagingRepository(db as never);

    await repo.insertBatch(
      [makeFiltered('accepted', 'ChIJ_001')],
      [{ id: 'raw-1', source_item_id: 'ChIJ_001' }],
      'vivere-60-mais',
    );

    const [rows] = db.upsert.mock.calls[0] as [object[]];
    expect((rows[0] as Record<string, unknown>)['proposal_status']).toBe('pending_review');
  });
});

// ─── ActivityStagingRepository ───────────────────────────────

describe('ActivityStagingRepository.insertBatch', () => {
  it('insere com venue_resolution_status = unresolved sempre', async () => {
    const db = makeUpsertDb([{ id: 'staging-act-uuid' }]);
    const repo = new ActivityStagingRepository(db as never);

    await repo.insertBatch(
      [makeRawActivity()],
      [{ id: 'raw-act-id', source_item_id: 'post_110155' }],
      'vivere-60-mais',
    );

    const [rows] = db.upsert.mock.calls[0] as [object[]];
    expect((rows[0] as Record<string, unknown>)['venue_resolution_status']).toBe('unresolved');
  });

  it('insere com proposal_status = pending_review sempre', async () => {
    const db = makeUpsertDb([{ id: 'staging-act-uuid' }]);
    const repo = new ActivityStagingRepository(db as never);

    await repo.insertBatch(
      [makeRawActivity()],
      [{ id: 'raw-act-id', source_item_id: 'post_110155' }],
      'vivere-60-mais',
    );

    const [rows] = db.upsert.mock.calls[0] as [object[]];
    expect((rows[0] as Record<string, unknown>)['proposal_status']).toBe('pending_review');
  });

  it('retorna 0 quando não há itens', async () => {
    const db = makeUpsertDb([]);
    const repo = new ActivityStagingRepository(db as never);
    const count = await repo.insertBatch([], [], 'vivere-60-mais');
    expect(count).toBe(0);
    expect(db.schema).not.toHaveBeenCalled();
  });
});
