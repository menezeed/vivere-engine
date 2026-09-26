/**
 * entity-resolution/repositories/impl/__tests__/ActivityResolutionRepository.test.ts
 *
 * Level 2, 2026-09-26 — caso N aprovado: source_key correctamente
 * mapeado a partir do JOIN com raw_activity_items (nenhum JOIN novo).
 *
 * ⚠ Se já existir um arquivo de teste com este nome, NÃO sobrescrever
 * cegamente — confirmar primeiro com Test-Path.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActivityResolutionRepository } from '../ActivityResolutionRepository';

function makeMockDb(row: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const schema = vi.fn().mockReturnValue({ from });
  return { schema } as any;
}

describe('ActivityResolutionRepository — N. source_key mapeado do raw_activity_items (Level 2, 2026-09-26)', () => {
  it('findById devolve source_key a partir do JOIN existente com raw_activity_items', async () => {
    const row = {
      id: 'activity-1',
      product_key: 'vivere-60-mais',
      venue_resolution_status: 'unresolved',
      raw_activity_items: {
        source_key: 'prefeitura_cabo_frio',
        venue_mention_raw_text: 'Canto do Forte, na Praia do Forte',
        venue_mention_raw_address_text: null,
        venue_mention_confidence_hint: 'explicit_name',
      },
    };
    const db = makeMockDb(row);
    const repo = new ActivityResolutionRepository(db);

    const activity = await repo.findById('activity-1' as any);

    expect(activity).not.toBeNull();
    expect(activity!.source_key).toBe('prefeitura_cabo_frio');
    expect(activity!.venue_mention).toEqual({
      raw_text: 'Canto do Forte, na Praia do Forte',
      raw_address_text: null,
      confidence_hint: 'explicit_name',
    });
  });

  it('findById devolve source_key vazio (fallback seguro) se raw_activity_items estiver ausente', async () => {
    const row = {
      id: 'activity-2',
      product_key: 'vivere-60-mais',
      venue_resolution_status: 'unresolved',
      raw_activity_items: null,
    };
    const db = makeMockDb(row);
    const repo = new ActivityResolutionRepository(db);

    const activity = await repo.findById('activity-2' as any);

    expect(activity!.source_key).toBe('');
  });
});
