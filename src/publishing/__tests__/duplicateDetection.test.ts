/**
 * src/publishing/__tests__/duplicateDetection.test.ts
 * Sprint 8.7 — testes do relatório de duplicados (não faz dedupe, só reporta).
 */

import { describe, it, expect } from 'vitest';
import { normalizeVenueName, haversineMeters, detectVenueDuplicates } from '../services/duplicateDetection.js';
import type { VenueForDuplicateCheck } from '../services/duplicateDetection.js';

describe('normalizeVenueName', () => {
  it('converte para minúsculas', () => {
    expect(normalizeVenueName('Praia Do Forte')).toBe('praia do forte');
  });

  it('remove acentos/diacríticos', () => {
    expect(normalizeVenueName('Praça do Moinho')).toBe('praca do moinho');
  });

  it('colapsa espaços múltiplos e remove padding', () => {
    expect(normalizeVenueName('  Praia   do Forte  ')).toBe('praia do forte');
  });

  it('nomes idênticos após normalização produzem a mesma chave', () => {
    expect(normalizeVenueName('Praia do Forte')).toBe(normalizeVenueName('praia do forte'));
    expect(normalizeVenueName('PRAÇA')).toBe(normalizeVenueName('praca'));
  });
});

describe('haversineMeters', () => {
  it('devolve 0 para o mesmo ponto', () => {
    expect(haversineMeters(-22.875, -42.008, -22.875, -42.008)).toBeCloseTo(0, 5);
  });

  it('calcula uma distância plausível para dois pontos próximos em Cabo Frio', () => {
    // ~0.001 grau de latitude ≈ 111 metros
    const distance = haversineMeters(-22.875, -42.008, -22.876, -42.008);
    expect(distance).toBeGreaterThan(90);
    expect(distance).toBeLessThan(130);
  });

  it('calcula uma distância grande para pontos em cidades diferentes', () => {
    // Cabo Frio vs Rio de Janeiro, aprox. 140km
    const distance = haversineMeters(-22.875, -42.008, -22.906, -43.172);
    expect(distance).toBeGreaterThan(100_000);
  });
});

describe('detectVenueDuplicates', () => {
  function makeVenue(overrides: Partial<VenueForDuplicateCheck> = {}): VenueForDuplicateCheck {
    return {
      stagingId: 'sv-001',
      name:      'Praia do Forte',
      city:      'Cabo Frio',
      lat:       -22.875,
      lng:       -42.008,
      ...overrides,
    };
  }

  it('não reporta nada quando todos os nomes são únicos', () => {
    const venues = [
      makeVenue({ stagingId: 'sv-001', name: 'Praia do Forte' }),
      makeVenue({ stagingId: 'sv-002', name: 'Praça do Moinho' }),
    ];
    expect(detectVenueDuplicates(venues)).toEqual([]);
  });

  it('agrupa venues com o mesmo nome normalizado, staging IDs diferentes', () => {
    const venues = [
      makeVenue({ stagingId: 'sv-001', name: 'Praia do Forte' }),
      makeVenue({ stagingId: 'sv-002', name: 'praia do forte' }), // mesma normalização
      makeVenue({ stagingId: 'sv-003', name: 'Outro Lugar' }),
    ];
    const groups = detectVenueDuplicates(venues);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.normalizedName).toBe('praia do forte');
    expect(groups[0]!.members).toHaveLength(2);
    expect(groups[0]!.members.map(m => m.stagingId).sort()).toEqual(['sv-001', 'sv-002']);
  });

  it('calcula a distância máxima entre membros do grupo quando têm coordenadas', () => {
    const venues = [
      makeVenue({ stagingId: 'sv-001', name: 'Praia do Forte', lat: -22.875, lng: -42.008 }),
      makeVenue({ stagingId: 'sv-002', name: 'Praia do Forte', lat: -22.876, lng: -42.008 }),
    ];
    const groups = detectVenueDuplicates(venues);

    expect(groups[0]!.maxDistanceMeters).not.toBeNull();
    expect(groups[0]!.maxDistanceMeters!).toBeGreaterThan(90);
    expect(groups[0]!.maxDistanceMeters!).toBeLessThan(130);
  });

  it('maxDistanceMeters é null quando algum membro não tem coordenadas', () => {
    const venues = [
      makeVenue({ stagingId: 'sv-001', name: 'Praia do Forte', lat: null, lng: null }),
      makeVenue({ stagingId: 'sv-002', name: 'Praia do Forte', lat: -22.876, lng: -42.008 }),
    ];
    const groups = detectVenueDuplicates(venues);

    expect(groups[0]!.maxDistanceMeters).toBeNull();
  });

  it('reporta o grupo mesmo quando os venues estão geograficamente distantes (nome é o único critério de agrupamento)', () => {
    const venues = [
      makeVenue({ stagingId: 'sv-001', name: 'Praia do Forte', lat: -22.875, lng: -42.008 }), // Cabo Frio
      makeVenue({ stagingId: 'sv-002', name: 'Praia do Forte', lat: -22.906, lng: -43.172 }), // Rio (hipotético)
    ];
    const groups = detectVenueDuplicates(venues);

    expect(groups).toHaveLength(1); // ainda reportado — decisão fica com o humano
    expect(groups[0]!.maxDistanceMeters!).toBeGreaterThan(100_000);
  });

  it('não faz dedupe — nunca remove nem altera nenhum venue, só reporta', () => {
    const venues = [
      makeVenue({ stagingId: 'sv-001', name: 'Praia do Forte' }),
      makeVenue({ stagingId: 'sv-002', name: 'Praia do Forte' }),
    ];
    const snapshot = JSON.stringify(venues);
    detectVenueDuplicates(venues);
    expect(JSON.stringify(venues)).toBe(snapshot);
  });

  it('grupos com 3+ membros são reportados correctamente', () => {
    const venues = [
      makeVenue({ stagingId: 'sv-001', name: 'Praça Central' }),
      makeVenue({ stagingId: 'sv-002', name: 'Praça Central' }),
      makeVenue({ stagingId: 'sv-003', name: 'Praça Central' }),
    ];
    const groups = detectVenueDuplicates(venues);

    expect(groups[0]!.members).toHaveLength(3);
  });

  it('ordena grupos maiores primeiro', () => {
    const venues = [
      makeVenue({ stagingId: 'sv-001', name: 'A' }),
      makeVenue({ stagingId: 'sv-002', name: 'A' }),
      makeVenue({ stagingId: 'sv-003', name: 'B' }),
      makeVenue({ stagingId: 'sv-004', name: 'B' }),
      makeVenue({ stagingId: 'sv-005', name: 'B' }),
    ];
    const groups = detectVenueDuplicates(venues);

    expect(groups[0]!.normalizedName).toBe('b');
    expect(groups[1]!.normalizedName).toBe('a');
  });
});
