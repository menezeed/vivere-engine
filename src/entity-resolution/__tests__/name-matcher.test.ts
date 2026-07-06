/**
 * entity-resolution/__tests__/name-matcher.test.ts
 *
 * Testes do NameMatcher e TextNormalizer.
 *
 * PRINCÍPIO: zero dependências externas.
 * Sem banco, sem Supabase, sem Hono, sem React, sem .env.
 * Apenas dados sintéticos e lógica pura.
 *
 * Exemplos reais usados:
 *   — Museu José de Dome (Cabo Frio)
 *   — Museu e Casa de Cultura José de Dome (Charitas)
 *   — Praia do Forte (Cabo Frio)
 *   — Canto do Forte, na Praia do Forte
 *   — Forte São Mateus
 *   — Cidade do Idoso
 *   — Cidade do Idoso (SEPIES)
 *   — Academia Viva 100% (São Pedro da Aldeia)
 *   — Academia nitro gym (Iguaba Grande)
 */

import { describe, it, expect } from 'vitest';
import {
  normalize,
  normalizeAndTokenize,
  removeDiacritics,
  removePunctuation,
  trigrams,
  trigramSimilarity,
  jaccardSimilarity,
  STOPWORDS_PT_BR,
  STOPWORDS_EN_GB,
} from '../utils/text.js';

import { NameMatcher, createNameMatcher, createNameMatcherEnGB } from '../matchers/NameMatcher.js';

import type { VenueCandidate, VenueStagingId } from '../types/domain.js';
import type { VenueMention } from '../../types/RawActivityItem.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function mention(raw_text: string, confidence_hint: VenueMention['confidence_hint'] = 'explicit_name'): VenueMention {
  return { raw_text, raw_address_text: null, confidence_hint };
}

function candidate(name: string, city = 'Cabo Frio RJ'): VenueCandidate {
  return {
    id:                   'venue-test' as VenueStagingId,
    product_key:          'vivere-60-mais',
    name,
    address:              null,
    city,
    lat:                  -22.879,
    lng:                  -42.019,
    google_types:         [],
    source_category_hint: null,
    proposal_status:      'approved',
  };
}

const matcher = createNameMatcher();

// ── 1. TextNormalizer — funções individuais ───────────────────────────────────

describe('removeDiacritics', () => {
  it('remove acentos pt-BR', () => {
    expect(removeDiacritics('José')).toBe('Jose');
    expect(removeDiacritics('São')).toBe('Sao');
    expect(removeDiacritics('Museu')).toBe('Museu');
    expect(removeDiacritics('Iguaba')).toBe('Iguaba');
  });

  it('preserva texto sem acentos', () => {
    expect(removeDiacritics('Academia')).toBe('Academia');
  });

  it('trata string vazia', () => {
    expect(removeDiacritics('')).toBe('');
  });
});

describe('removePunctuation', () => {
  it('remove vírgulas e parênteses', () => {
    expect(removePunctuation('Canto do Forte, na Praia')).toBe('Canto do Forte  na Praia');
    expect(removePunctuation('Cidade do Idoso (SEPIES)')).toBe('Cidade do Idoso  SEPIES ');
  });

  it('remove hífen e ponto', () => {
    expect(removePunctuation('nitro-gym')).toBe('nitro gym');
    expect(removePunctuation('Academia Viva 100%')).toBe('Academia Viva 100 ');
  });
});

describe('normalize', () => {
  it('normaliza "Museu José de Dome" → "museu jose dome"', () => {
    expect(normalize('Museu José de Dome')).toBe('museu jose dome');
  });

  it('normaliza "Canto do Forte, na Praia do Forte" → "canto forte praia forte"', () => {
    expect(normalize('Canto do Forte, na Praia do Forte')).toBe('canto forte praia forte');
  });

  it('normaliza "Cidade do Idoso (SEPIES)" → "cidade idoso sepies"', () => {
    expect(normalize('Cidade do Idoso (SEPIES)')).toBe('cidade idoso sepies');
  });

  it('normaliza "Museu e Casa de Cultura José de Dome (Charitas)" → remove stopwords e parênteses', () => {
    const result = normalize('Museu e Casa de Cultura José de Dome (Charitas)');
    expect(result).toContain('museu');
    expect(result).toContain('jose');
    expect(result).toContain('dome');
    expect(result).not.toContain(' e ');
    expect(result).not.toContain('(');
  });

  it('preserva pelo menos 1 token quando todos são stopwords', () => {
    const result = normalize('de da do');
    expect(result.length).toBeGreaterThan(0);
  });

  it('normaliza en-GB com stopwords inglesas', () => {
    const result = normalize('The Old Deer Park', { stopwords: STOPWORDS_EN_GB });
    expect(result).toBe('old deer park');
  });

  it('sem remoção de stopwords quando removeStopwords=false', () => {
    const result = normalize('Museu de Arte', { removeStopwords: false });
    expect(result).toBe('museu de arte');
  });
});

describe('trigramSimilarity', () => {
  it('strings idênticas → 1.0', () => {
    expect(trigramSimilarity('museu', 'museu')).toBe(1);
  });

  it('strings completamente diferentes → próximo de 0', () => {
    expect(trigramSimilarity('museu', 'praia')).toBeLessThan(0.3);
  });

  it('"museu jose dome" vs "museu casa cultura jose dome" → similaridade significativa', () => {
    const a = normalize('Museu José de Dome');
    const b = normalize('Museu e Casa de Cultura José de Dome');
    expect(trigramSimilarity(a, b)).toBeGreaterThan(0.3);
  });

  it('string vazia → 0', () => {
    expect(trigramSimilarity('', 'museu')).toBe(0);
  });
});

describe('jaccardSimilarity', () => {
  it('conjuntos idênticos → 1.0', () => {
    expect(jaccardSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
  });

  it('conjuntos disjuntos → 0.0', () => {
    expect(jaccardSimilarity(['museu'], ['praia'])).toBe(0);
  });

  it('"forte praia" vs "praia forte" → 1.0 (mesmos tokens)', () => {
    expect(jaccardSimilarity(['forte', 'praia'], ['praia', 'forte'])).toBe(1);
  });

  it('overlap parcial calculado correctamente', () => {
    // {a, b} ∩ {b, c} = {b}; união = {a, b, c} = 3 → 1/3
    expect(jaccardSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 3);
  });
});

// ── 2. NameMatcher — exemplos reais de Cabo Frio ─────────────────────────────

describe('NameMatcher — exemplos reais', () => {

  // ── Exact Match ─────────────────────────────────────────────────────────────

  it('Exact: "Praia do Forte" vs Praia do Forte → 1.0', () => {
    const s = matcher.score(mention('Praia do Forte'), candidate('Praia do Forte'));
    expect(s.value).toBe(1.0);
    expect(s.subMethod).toBe('exact');
  });

  it('Exact: normalização remove acentos antes de comparar', () => {
    const s = matcher.score(mention('Museu Jose de Dome'), candidate('Museu José de Dome'));
    expect(s.value).toBe(1.0);
    expect(s.subMethod).toBe('exact');
  });

  it('Exact: case-insensitive', () => {
    const s = matcher.score(mention('FORTE SAO MATEUS'), candidate('Forte São Mateus'));
    expect(s.value).toBe(1.0);
    expect(s.subMethod).toBe('exact');
  });

  // ── Contains Match ──────────────────────────────────────────────────────────

  it('Contains: "Canto do Forte, na Praia do Forte" contém "Praia do Forte"', () => {
    const s = matcher.score(
      mention('Canto do Forte, na Praia do Forte'),
      candidate('Praia do Forte'),
    );
    expect(s.value).toBeGreaterThanOrEqual(0.60);
    expect(s.value).toBeLessThanOrEqual(0.80);
    expect(s.subMethod).toBe('contains');
  });

  it('Contains: menção "Museu José de Dome" contida em candidato mais longo', () => {
    const s = matcher.score(
      mention('Museu José de Dome'),
      candidate('Museu e Casa de Cultura José de Dome (Charitas)'),
    );
    expect(s.value).toBeGreaterThanOrEqual(0.35);
    // subMethod pode ser 'contains' ou 'trigram' — ambos são correctos
    // dependendo do texto normalizado (stopwords removidas alteram a comparação)
    expect(['contains', 'trigram', 'token_overlap']).toContain(s.subMethod);
  });

  it('Contains: "Museu e Casa de Cultura José de Dome (Charitas)" contém "Museu José de Dome"', () => {
    const s = matcher.score(
      mention('Museu e Casa de Cultura José de Dome (Charitas)'),
      candidate('Museu José de Dome'),
    );
    expect(s.value).toBeGreaterThanOrEqual(0.35);
    expect(['contains', 'trigram', 'token_overlap']).toContain(s.subMethod);
  });

  it('Contains: "Cidade do Idoso (SEPIES)" contém "Cidade do Idoso"', () => {
    const s = matcher.score(
      mention('Cidade do Idoso (SEPIES)'),
      candidate('Cidade do Idoso'),
    );
    expect(s.value).toBeGreaterThanOrEqual(0.65);
    expect(s.subMethod).toBe('contains');
  });

  // ── Token Overlap / Jaccard ──────────────────────────────────────────────────

  it('Jaccard: "Forte São Mateus" vs "Praia do Forte" → overlap em "forte"', () => {
    const s = matcher.score(
      mention('Forte São Mateus'),
      candidate('Praia do Forte'),
    );
    // Partilham token "forte" — score baixo mas acima de zero
    expect(s.value).toBeGreaterThan(0);
    expect(s.value).toBeLessThan(0.50);
  });

  it('Jaccard: "Academia Viva 100" vs "Academia nitro gym" → pouco overlap', () => {
    const s = matcher.score(
      mention('Academia Viva 100%'),
      candidate('Academia nitro gym'),
    );
    // Partilham apenas "academia"
    expect(s.value).toBeGreaterThan(0);
    expect(s.value).toBeLessThan(0.40);
  });

  // ── Trigram Similarity ───────────────────────────────────────────────────────

  it('Trigram: erros tipográficos — "Praia Forte" vs "Praia do Forte"', () => {
    const s = matcher.score(
      mention('Praia Forte'),
      candidate('Praia do Forte'),
    );
    expect(s.value).toBeGreaterThan(0.30);
  });

  it('Trigram: abreviação — "Mus. José Dome" vs "Museu José de Dome"', () => {
    const s = matcher.score(
      mention('Mus Jose Dome'),
      candidate('Museu José de Dome'),
    );
    expect(s.value).toBeGreaterThan(0.20);
  });

  // ── Sem match ────────────────────────────────────────────────────────────────

  it('Score baixo: "Supermercado Central" vs "Museu José de Dome"', () => {
    const s = matcher.score(
      mention('Supermercado Central'),
      candidate('Museu José de Dome'),
    );
    expect(s.value).toBeLessThan(0.30);
  });

  it('Score zero: texto vazio na menção', () => {
    const s = matcher.score(mention(''), candidate('Museu José de Dome'));
    expect(s.value).toBe(0);
  });

  it('Score zero: nome vazio no candidato', () => {
    const s = matcher.score(mention('Museu'), candidate(''));
    expect(s.value).toBe(0);
  });

  // ── Contratos obrigatórios ───────────────────────────────────────────────────

  it('id do matcher é "name"', () => {
    expect(matcher.id).toBe('name');
  });

  it('score nunca retorna null — NameMatcher sempre tem valor', () => {
    const s = matcher.score(mention('qualquer texto'), candidate('outro nome'));
    expect(s).not.toBeNull();
    expect(typeof s.value).toBe('number');
  });

  it('todos os scores ficam entre 0 e 1', () => {
    const pairs = [
      [mention('Museu José de Dome'),                    candidate('Museu José de Dome')],
      [mention('Canto do Forte, na Praia do Forte'),     candidate('Praia do Forte')],
      [mention('Cidade do Idoso (SEPIES)'),              candidate('Cidade do Idoso')],
      [mention('Academia Viva 100%'),                    candidate('Academia nitro gym')],
      [mention('Forte São Mateus'),                      candidate('Praia do Forte')],
      [mention('texto completamente diferente aqui'),    candidate('Museu José de Dome')],
    ] as [VenueMention, VenueCandidate][];

    for (const [m, c] of pairs) {
      const s = matcher.score(m, c);
      expect(s.value).toBeGreaterThanOrEqual(0);
      expect(s.value).toBeLessThanOrEqual(1);
    }
  });

  it('MatchScore tem detail legível por humano', () => {
    const s = matcher.score(mention('Praia do Forte'), candidate('Praia do Forte'));
    expect(s.detail).toBeTruthy();
    expect(typeof s.detail).toBe('string');
    expect(s.detail.length).toBeGreaterThan(5);
  });

  it('MatchScore.method é sempre "name"', () => {
    const s = matcher.score(mention('qualquer'), candidate('outro'));
    expect(s.method).toBe('name');
  });

  // ── En-GB ────────────────────────────────────────────────────────────────────

  it('En-GB: "The Old Deer Park" vs "Old Deer Park" → exact após remover "The"', () => {
    const matcherEN = createNameMatcherEnGB();
    const s = matcherEN.score(
      mention('The Old Deer Park'),
      candidate('Old Deer Park', 'Richmond UK'),
    );
    expect(s.value).toBe(1.0);
    expect(s.subMethod).toBe('exact');
  });

  it('En-GB: "Richmond Town Hall" vs "The Richmond Town Hall"', () => {
    const matcherEN = createNameMatcherEnGB();
    const s = matcherEN.score(
      mention('Richmond Town Hall'),
      candidate('The Richmond Town Hall', 'Richmond UK'),
    );
    expect(s.value).toBeGreaterThan(0.70);
  });

  // ── Ordenação relativa (mais importante que scores absolutos nesta sprint) ───

  it('Ranking: exact > contains > jaccard para "Praia do Forte"', () => {
    const exact    = matcher.score(mention('Praia do Forte'), candidate('Praia do Forte'));
    const contains = matcher.score(mention('Canto do Forte, na Praia do Forte'), candidate('Praia do Forte'));
    const jaccard  = matcher.score(mention('Forte São Mateus'), candidate('Praia do Forte'));

    expect(exact.value).toBeGreaterThan(contains.value);
    expect(contains.value).toBeGreaterThan(jaccard.value);
  });

  it('Ranking: "Cidade do Idoso" exacto bate "Cidade do Idoso (SEPIES)" contains', () => {
    const exact    = matcher.score(mention('Cidade do Idoso'), candidate('Cidade do Idoso'));
    const contains = matcher.score(mention('Cidade do Idoso (SEPIES)'), candidate('Cidade do Idoso'));

    expect(exact.value).toBeGreaterThanOrEqual(contains.value);
  });
});
