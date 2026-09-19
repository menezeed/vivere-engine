/**
 * src/publishing/__tests__/PublishableActivityRepository.enrichWithPublicVenueIds.test.ts
 *
 * Testa o isolamento de erro por linha em enrichWithPublicVenueIds() —
 * distinto de PublishableActivityRepository.parseOccurrences.test.ts, que
 * testa a função parseOccurrences() isoladamente (e já cobre, sem alteração
 * nesta correcção, o caso de occurrences sem `date`).
 *
 * Esta correcção NÃO muda parseOccurrences() nem o contrato de occurrences.
 * Corrige apenas o facto de uma excepção de parseOccurrences(), lançada ao
 * mapear uma linha dentro de enrichWithPublicVenueIds(), abortar a leitura
 * de TODAS as linhas em vez de isolar só a linha problemática — violação
 * da garantia já documentada em ActivityPublisher.ts ("um erro numa
 * activity não interrompe o processamento das restantes").
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PublishableActivityRepository } from '../repositories/impl/PublishableActivityRepository.js';

vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from '../../lib/logger.js';

/**
 * Constrói um SupabaseClient falso que resolve `.schema().from(table)...`
 * para a resposta fixa correspondente à tabela, sem validar os argumentos
 * intermédios da cadeia (.eq/.in/.is/.not são no-ops que devolvem `this`).
 */
function makeMockDb(responses: {
  activitiesStaging: { data: unknown[] | null; error: { message: string } | null };
  venuesStaging?: { data: unknown[] | null };
}): SupabaseClient {
  function chainable(resolved: unknown) {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:     () => builder,
      in:     () => builder,
      is:     () => builder,
      not:    () => builder,
      then:   (resolve: (v: unknown) => void) => resolve(resolved),
    };
    return builder;
  }

  return {
    schema: () => ({
      from: (table: string) => {
        if (table === 'activities_staging') return chainable(responses.activitiesStaging);
        if (table === 'venues_staging')      return chainable(responses.venuesStaging ?? { data: [] });
        throw new Error(`makeMockDb: tabela inesperada "${table}"`);
      },
    }),
  } as unknown as SupabaseClient;
}

describe('PublishableActivityRepository — isolamento de erro por linha (occurrences inválido)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('válida + occurrences inválido (day_of_week) + válida → as duas válidas são devolvidas, a inválida é isolada e registada via logger', async () => {
    const rows = [
      {
        id: 'staging-valid-1',
        product_key: 'vivere-60-mais',
        promoted_activity_id: null,
        resolved_venue_staging_id: null,
        venue_resolution_status: 'matched',
        raw_activity_items: {
          source_key: 'prefeitura_cabo_frio',
          title: 'Arraiá do Peró',
          description: null,
          occurrences: [{ date: '2026-06-26', time: '17:00', end_date: null, end_time: null }],
          image_url: null,
          external_url: null,
          contact_phone: null,
          collected_at: '2026-06-01T00:00:00Z',
        },
      },
      {
        id: 'staging-invalid-recurrence',
        product_key: 'vivere-60-mais',
        promoted_activity_id: null,
        resolved_venue_staging_id: null,
        venue_resolution_status: 'matched',
        raw_activity_items: {
          source_key: 'prefeitura_iguaba_grande',
          title: 'Oficina de Moda e Costura para Idosos',
          description: null,
          // Formato de recorrência por dia da semana — sem `date`, inválido
          // para o contrato actual de occurrences. NÃO deve ser suportado
          // por esta correcção (ver nota no cabeçalho deste ficheiro).
          occurrences: [{ time: '14:00', day_of_week: 'tuesday' }],
          image_url: null,
          external_url: null,
          contact_phone: null,
          collected_at: '2026-06-01T00:00:00Z',
        },
      },
      {
        id: 'staging-valid-2',
        product_key: 'vivere-60-mais',
        promoted_activity_id: null,
        resolved_venue_staging_id: null,
        venue_resolution_status: 'proposed_new',
        raw_activity_items: {
          source_key: 'prefeitura_cabo_frio',
          title: 'Artesanato cabo-friense recebe moção de aplausos da Câmara Municipal',
          description: null,
          occurrences: [{ date: '2026-07-30', time: null, end_date: null, end_time: null }],
          image_url: null,
          external_url: null,
          contact_phone: null,
          collected_at: '2026-06-01T00:00:00Z',
        },
      },
    ];

    const db = makeMockDb({ activitiesStaging: { data: rows, error: null } });
    const repo = new PublishableActivityRepository(db);

    const result = await repo.findUnpublished('vivere-60-mais');

    // Critério 1 e 2 — a leitura não aborta; as duas válidas chegam ao Publisher.
    expect(result).toHaveLength(2);
    expect(result.map(a => a.stagingId)).toEqual(['staging-valid-1', 'staging-valid-2']);

    // Critério 3 — a inválida nunca aparece no resultado (nunca será publicada).
    expect(result.some(a => a.stagingId === 'staging-invalid-recurrence')).toBe(false);

    // Critério 4 — a falha é observável, com contexto suficiente para investigação.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        stagingId: 'staging-invalid-recurrence',
        sourceKey: 'prefeitura_iguaba_grande',
        title:     'Oficina de Moda e Costura para Idosos',
        reason:    expect.stringContaining('occurrences[0].date'),
      }),
      expect.any(String),
    );
  });

  it('occurrences: [] (vazio) continua a ser aceite, sem erro nem exclusão', async () => {
    const rows = [
      {
        id: 'staging-empty-occurrences',
        product_key: 'vivere-60-mais',
        promoted_activity_id: null,
        resolved_venue_staging_id: null,
        venue_resolution_status: 'matched',
        raw_activity_items: {
          source_key: 'prefeitura_cabo_frio',
          title: 'Coral da Melhor Idade',
          description: null,
          occurrences: [],
          image_url: null,
          external_url: null,
          contact_phone: null,
          collected_at: '2026-06-01T00:00:00Z',
        },
      },
    ];

    const db = makeMockDb({ activitiesStaging: { data: rows, error: null } });
    const repo = new PublishableActivityRepository(db);

    const result = await repo.findUnpublished('vivere-60-mais');

    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
