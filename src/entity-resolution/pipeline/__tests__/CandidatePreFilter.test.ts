/**
 * entity-resolution/pipeline/__tests__/CandidatePreFilter.test.ts
 *
 * Level 2, 2026-09-26 — regressão do caso real "Canto do Forte" e
 * cobertura dos casos A-G aprovados.
 *
 * ⚠ Se já existir um arquivo de teste com este nome, NÃO sobrescrever
 * cegamente — confirmar primeiro com Test-Path e mesclar manualmente.
 * Não tenho confirmação nesta sessão de que já existem testes de
 * CandidatePreFilter.
 */

import { describe, it, expect } from 'vitest';
import { CandidatePreFilter } from '../CandidatePreFilter';
import type { CandidatePool, VenueCandidate, TrustedCityContext } from '../../types/domain.js';
import type { CandidateSelectionConfig } from '../../config/index.js';

const BASE_CONFIG: CandidateSelectionConfig = {
  maxCandidates: 50,
  maxRadiusMeters: 5000,
  allowCrossCity: false,
  allowedVenueStatuses: ['approved', 'promoted'],
  categoryBoost: true,
};

function makeCandidate(overrides: Partial<VenueCandidate> = {}): VenueCandidate {
  return {
    id: 'venue-' + Math.random().toString(36).slice(2) as any,
    product_key: 'vivere-60-mais',
    name: 'Candidato',
    address: null,
    city: null,
    lat: null,
    lng: null,
    google_types: [],
    source_category_hint: null,
    proposal_status: 'promoted',
    ...overrides,
  };
}

function makePool(candidates: VenueCandidate[], trustedCityContext: TrustedCityContext | null): CandidatePool {
  return {
    activityId: 'activity-1' as any,
    venueMention: { raw_text: 'Canto do Forte, na Praia do Forte', raw_address_text: null, confidence_hint: 'explicit_name' },
    productKey: 'vivere-60-mais',
    candidates,
    generatedAt: Date.now(),
    trustedCityContext,
  };
}

const filter = new CandidatePreFilter();

describe('CandidatePreFilter — Level 2, 2026-09-26 (caso real Canto do Forte)', () => {
  it('A. trusted Cabo Frio: Canto do Forte não é eliminado, mesmo com Iguaba Grande em maioria no pool', () => {
    const cantoDoForte = makeCandidate({ id: 'canto-do-forte' as any, name: 'Canto do Forte', city: 'Cabo Frio RJ' });
    const candidates: VenueCandidate[] = [cantoDoForte];
    for (let i = 0; i < 28; i++) {
      candidates.push(makeCandidate({ city: 'Iguaba Grande RJ', name: `Iguaba ${i}` }));
    }
    for (let i = 0; i < 20; i++) {
      candidates.push(makeCandidate({ city: 'Cabo Frio RJ', name: `Cabo Frio ${i}` }));
    }

    const pool = makePool(candidates, { city: 'Cabo Frio', state: 'RJ' });
    const result = filter.filter(pool, BASE_CONFIG);

    expect(result.candidates.some(c => c.id === 'canto-do-forte')).toBe(true);
  });

  it('B. pool com maioria Iguaba não influencia a selecção territorial quando há trusted city', () => {
    const candidates: VenueCandidate[] = [];
    for (let i = 0; i < 28; i++) candidates.push(makeCandidate({ city: 'Iguaba Grande RJ' }));
    for (let i = 0; i < 21; i++) candidates.push(makeCandidate({ city: 'Cabo Frio RJ' }));

    const pool = makePool(candidates, { city: 'Cabo Frio', state: 'RJ' });
    const result = filter.filter(pool, BASE_CONFIG);

    expect(result.candidates.every(c => c.city === 'Cabo Frio RJ')).toBe(true);
    expect(result.candidates).toHaveLength(21);
  });

  it('C. sem trustedCityContext: nenhum filtro de cidade é aplicado — todos os candidatos permanecem', () => {
    const candidates: VenueCandidate[] = [];
    for (let i = 0; i < 28; i++) candidates.push(makeCandidate({ city: 'Iguaba Grande RJ' }));
    for (let i = 0; i < 21; i++) candidates.push(makeCandidate({ city: 'Cabo Frio RJ' }));

    const pool = makePool(candidates, null);
    const result = filter.filter(pool, BASE_CONFIG);

    expect(result.candidates).toHaveLength(49); // 28 + 21, nenhum removido por cidade
  });

  it('D. sem trustedCityContext: nenhum referencePoint é derivado — sem filtro de raio, sem ordenação por proximidade', () => {
    const near = makeCandidate({ id: 'near' as any, city: 'Cabo Frio RJ', lat: -22.8806, lng: -42.0187 });
    const far  = makeCandidate({ id: 'far'  as any, city: 'Iguaba Grande RJ', lat: -22.8389, lng: -42.2276 });

    const pool = makePool([far, near], null); // ordem: far primeiro
    const result = filter.filter(pool, BASE_CONFIG);

    // sem referencePoint, nenhuma ordenação por proximidade — ordem de chegada preservada
    expect(result.candidates.map(c => c.id)).toEqual(['far', 'near']);
  });

  it('E. trusted city presente: candidatos de outra cidade (reconhecida) são filtrados', () => {
    const cabo = makeCandidate({ id: 'cabo' as any, city: 'Cabo Frio RJ' });
    const iguaba = makeCandidate({ id: 'iguaba' as any, city: 'Iguaba Grande RJ' });

    const pool = makePool([cabo, iguaba], { city: 'Cabo Frio', state: 'RJ' });
    const result = filter.filter(pool, BASE_CONFIG);

    expect(result.candidates.map(c => c.id)).toEqual(['cabo']);
  });

  it('F. candidate.city = null: preserva a política existente — nunca é removido pelo filtro de cidade', () => {
    const semCidade = makeCandidate({ id: 'sem-cidade' as any, city: null });
    const iguaba = makeCandidate({ id: 'iguaba' as any, city: 'Iguaba Grande RJ' });

    const pool = makePool([semCidade, iguaba], { city: 'Cabo Frio', state: 'RJ' });
    const result = filter.filter(pool, BASE_CONFIG);

    expect(result.candidates.some(c => c.id === 'sem-cidade')).toBe(true);
    expect(result.candidates.some(c => c.id === 'iguaba')).toBe(false);
  });

  it('G. maxCandidates continua aplicado mesmo sem contexto territorial', () => {
    const candidates: VenueCandidate[] = [];
    for (let i = 0; i < 60; i++) candidates.push(makeCandidate({ id: `c-${i}` as any }));

    const config = { ...BASE_CONFIG, maxCandidates: 10 };
    const pool = makePool(candidates, null);
    const result = filter.filter(pool, config);

    expect(result.candidates).toHaveLength(10);
  });

  it('cidade não reconhecida em CITY_CENTROIDS (ex: futura fonte de SP) nunca corresponde por acaso — sem falso positivo', () => {
    const santoAmaro = makeCandidate({ id: 'sp' as any, city: 'Santo Amaro, Sao Paulo' });
    const cabo = makeCandidate({ id: 'cabo' as any, city: 'Cabo Frio RJ' });

    const pool = makePool([santoAmaro, cabo], { city: 'Cabo Frio', state: 'RJ' });
    const result = filter.filter(pool, BASE_CONFIG);

    expect(result.candidates.map(c => c.id)).toEqual(['cabo']);
  });
});
