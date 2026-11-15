/**
 * Arquivar uma activity pública tem de a esconder no app.
 *
 * O app lê public.active_activities (db/migrations/0000_app_baseline.sql),
 * que NÃO filtra engine_status. `activeActivitiesPredicate` reproduz o WHERE
 * dessa vista; o teste de ligação ao SQL garante que não divergem.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PublicActivityRepository,
  archivedEndDate,
} from '../repositories/impl/PublicActivityRepository.js';
import type { PublicActivityId, PublishableActivity } from '../types/domain.js';

type Row = {
  start_date: string | null;
  end_date: string | null;
  recurrence_type: string | null;
};

/** WHERE de public.active_activities, com current_date = dia UTC de `today`. */
function activeActivitiesPredicate(row: Row, today: Date): boolean {
  const currentDate = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const day = (iso: string) => {
    const d = new Date(iso);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const endOk = row.end_date === null || day(row.end_date) >= currentDate;
  const recurring = row.recurrence_type !== null && row.recurrence_type !== 'none';
  const oneOffFuture = row.recurrence_type === 'none' && row.start_date !== null && day(row.start_date) >= currentDate;
  return endOk && (recurring || oneOffFuture);
}

function fakeDb() {
  const updates: Array<{ table: string; payload: Record<string, unknown>; id: unknown }> = [];
  const db = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          return {
            eq(_col: string, id: unknown) {
              updates.push({ table, payload, id });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { db, updates };
}

const ID = 'pub-1' as PublicActivityId;

describe('PublicActivityRepository.archive esconde a activity no app', () => {
  it('a vista do baseline continua a não filtrar engine_status (razão desta correcção)', () => {
    const sql = readFileSync(new URL('../../../db/migrations/0000_app_baseline.sql', import.meta.url), 'utf8');
    const view = sql.slice(sql.indexOf('create view public.active_activities'));
    const where = view.slice(view.indexOf('where'), view.indexOf(';')).replace(/\s+/g, ' ').trim();
    // Expressão completa: um AND trocado por OR (ou outro filtro) muda o
    // predicado reproduzido abaixo e tem de partir este teste.
    expect(where).toBe(
      "where (end_date is null or end_date >= current_date) and (recurrence_type is not null and recurrence_type <> 'none' or recurrence_type = 'none' and start_date >= current_date)",
    );
  });

  it('grava engine_status=archived e end_date dois dias UTC antes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T23:30:00-03:00')); // 16/11 02:30 UTC
    try {
      const { db, updates } = fakeDb();
      await new PublicActivityRepository(db).archive(ID);
      expect(updates).toHaveLength(1);
      expect(updates[0].table).toBe('activities');
      expect(updates[0].id).toBe(ID);
      expect(updates[0].payload['engine_status']).toBe('archived');
      expect(updates[0].payload['end_date']).toBe('2026-11-14T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['diária sem fim', { start_date: null, end_date: null, recurrence_type: 'daily' }],
    ['semanal com fim futuro', { start_date: '2026-11-01T00:00:00Z', end_date: '2027-03-01T00:00:00Z', recurrence_type: 'weekly' }],
    ['pontual futura', { start_date: '2026-12-01T22:00:00Z', end_date: null, recurrence_type: 'none' }],
  ] as const)('%s: visível antes, invisível depois de arquivar', (_n, row) => {
    for (const iso of ['2026-11-15T00:00:00Z', '2026-11-15T12:00:00Z', '2026-11-15T23:59:59Z']) {
      const now = new Date(iso);
      expect(activeActivitiesPredicate(row, now)).toBe(true);
      const archived = { ...row, end_date: archivedEndDate(now).toISOString() };
      expect(activeActivitiesPredicate(archived, now)).toBe(false);
    }
  });

  it('relógio do processo adiantado até 24 h em relação à base: continua invisível', () => {
    const row = { start_date: null, end_date: null, recurrence_type: 'daily' };
    // processo já em 16/11 00:00:05 UTC; base ainda em 15/11 23:59:59 UTC
    const processNow = new Date('2026-11-16T00:00:05Z');
    const dbNow = new Date('2026-11-15T23:59:59Z');
    const archived = { ...row, end_date: archivedEndDate(processNow).toISOString() };
    expect(activeActivitiesPredicate(archived, dbNow)).toBe(false);
    const farAhead = new Date('2026-11-16T23:59:00Z');
    expect(activeActivitiesPredicate({ ...row, end_date: archivedEndDate(farAhead).toISOString() }, dbNow)).toBe(false);
  });

  it('republicar (update) volta a marcar engine_status=active e repõe end_date', async () => {
    const { db, updates } = fakeDb();
    const activity = {
      title: 't', description: null, startDate: new Date('2026-12-01T22:00:00Z'), endDate: null,
      imageUrl: null, sourceUrl: null, phone: null, resolvedPublicVenueId: null,
      recurrenceType: 'none', recurrenceDays: null, recurrenceTime: null,
    } as unknown as PublishableActivity;
    await new PublicActivityRepository(db).update(ID, activity);
    expect(updates[0].payload['engine_status']).toBe('active');
    expect(updates[0].payload['end_date']).toBeNull();
  });
});
