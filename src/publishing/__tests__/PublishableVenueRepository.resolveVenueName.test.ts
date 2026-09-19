/**
 * src/publishing/__tests__/PublishableVenueRepository.resolveVenueName.test.ts
 * Sprint 8.7 — testa a precedência venues_staging.name (curado) vs
 * raw_venue_items.name (bruto), decisão confirmada nesta sprint.
 */

import { describe, it, expect } from 'vitest';
import { resolveVenueName } from '../repositories/impl/PublishableVenueRepository.js';

describe('resolveVenueName — nome curado sobrescreve o nome bruto', () => {
  it('usa o nome curado quando presente e não-vazio', () => {
    expect(resolveVenueName('Canto do Forte', 'Praia do Forte')).toBe('Canto do Forte');
  });

  it('usa o nome curado mesmo quando difere completamente do bruto', () => {
    expect(resolveVenueName('Nome Totalmente Diferente', 'Nome Original')).toBe('Nome Totalmente Diferente');
  });

  it('faz trim ao nome curado antes de usar', () => {
    expect(resolveVenueName('  Canto do Forte  ', 'Praia do Forte')).toBe('Canto do Forte');
  });
});

describe('resolveVenueName — NULL usa fallback para raw.name', () => {
  it('null → fallback', () => {
    expect(resolveVenueName(null, 'Praia do Forte')).toBe('Praia do Forte');
  });

  it('undefined → fallback', () => {
    expect(resolveVenueName(undefined, 'Praia do Forte')).toBe('Praia do Forte');
  });

  it('valor não-string (ex: número, por corrupção de dados) → fallback', () => {
    expect(resolveVenueName(42, 'Praia do Forte')).toBe('Praia do Forte');
  });
});

describe('resolveVenueName — string vazia ou só espaços também usa fallback', () => {
  it('string vazia → fallback (decisão explícita, não publica nome vazio)', () => {
    expect(resolveVenueName('', 'Praia do Forte')).toBe('Praia do Forte');
  });

  it('string só com espaços → fallback', () => {
    expect(resolveVenueName('   ', 'Praia do Forte')).toBe('Praia do Forte');
  });

  it('string com tabs/quebras de linha só → fallback', () => {
    expect(resolveVenueName('\t\n  ', 'Praia do Forte')).toBe('Praia do Forte');
  });
});

describe('resolveVenueName — fallback também é normalizado (trim)', () => {
  it('faz trim ao nome bruto quando usado como fallback', () => {
    expect(resolveVenueName(null, '  Praia do Forte  ')).toBe('Praia do Forte');
  });

  it('ambos ausentes/vazios → string vazia (nunca lança)', () => {
    expect(resolveVenueName(null, null)).toBe('');
    expect(resolveVenueName('', '')).toBe('');
    expect(resolveVenueName('   ', undefined)).toBe('');
  });
});
