/**
 * Issue #60 — paginação do Admin: 1/7 → 7/7 sem perder filtros.
 * Simula a sequência de URLs que os botões da Pagination produzem.
 */
import { describe, it, expect } from 'vitest';
import {
  readPage, readFilters, withFilter, withFilters, withPage, clampPage,
} from '../urlFilterParams';

// Defaults reais da ActivitiesPage — SEM `page` (era aqui o bug).
const ACTIVITY_DEFAULTS = {
  status: 'pending_review',
  search: undefined as string | undefined,
  venue_resolution: undefined as string | undefined,
  pageSize: '20',
  sort: 'created_at',
  order: 'desc',
};

const TOTAL_PAGES = 7; // 133 actividades / 20 por página

describe('readPage', () => {
  it('sem ?page é a página 1', () => {
    expect(readPage(new URLSearchParams(''))).toBe(1);
  });
  it('lê ?page mesmo que os defaults do chamador não incluam page (bug #60)', () => {
    const params = new URLSearchParams('status=pending_review&page=2');
    expect(readFilters(params, ACTIVITY_DEFAULTS)).not.toHaveProperty('page');
    expect(readPage(params)).toBe(2);
  });
  it.each(['0', '-1', 'abc', '2.5', ''])('valor inválido %j → 1', (v) => {
    expect(readPage(new URLSearchParams({ page: v }))).toBe(1);
  });
});

describe('navegar da página 1 à 7 sem perder filtros', () => {
  const start = new URLSearchParams(
    'status=pending_review&search=art&venue_resolution=unresolved&pageSize=20&sort=created_at&order=asc',
  );

  it('botão seguinte avança 1→2→…→7 e todos os filtros se mantêm', () => {
    let url = start;
    expect(readPage(url)).toBe(1);
    for (let expected = 2; expected <= TOTAL_PAGES; expected++) {
      url = withPage(url, readPage(url) + 1);
      expect(readPage(url)).toBe(expected);
      expect(readFilters(url, ACTIVITY_DEFAULTS)).toEqual({
        status: 'pending_review', search: 'art', venue_resolution: 'unresolved',
        pageSize: '20', sort: 'created_at', order: 'asc',
      });
    }
    expect(url.get('page')).toBe('7');
  });

  it('botão anterior volta 7→1 e a página 1 remove o parâmetro', () => {
    let url = withPage(start, 7);
    for (let expected = 6; expected >= 1; expected--) {
      url = withPage(url, readPage(url) - 1);
      expect(readPage(url)).toBe(expected);
    }
    expect(url.has('page')).toBe(false);
    expect(url.get('search')).toBe('art');
  });

  it('« e » saltam para 1 e para a última página', () => {
    expect(readPage(withPage(start, TOTAL_PAGES))).toBe(7);
    expect(readPage(withPage(withPage(start, 4), 1))).toBe(1);
  });

  it('refresh: o URL da página 5 reconstrói a mesma página e filtros', () => {
    const shared = withPage(start, 5).toString();
    const reloaded = new URLSearchParams(shared);
    expect(readPage(reloaded)).toBe(5);
    expect(readFilters(reloaded, ACTIVITY_DEFAULTS).venue_resolution).toBe('unresolved');
  });
});

describe('mudar filtros volta à página 1', () => {
  const onPage4 = new URLSearchParams('status=pending_review&search=art&page=4');

  it('setFilter de um filtro', () => {
    const next = withFilter(onPage4, 'status', 'rejected');
    expect(readPage(next)).toBe(1);
    expect(next.get('search')).toBe('art');
  });
  it('setFilter de page mantém a página', () => {
    expect(readPage(withFilter(onPage4, 'page', '6'))).toBe(6);
  });
  it('setFilters (ordenação) volta à página 1', () => {
    const next = withFilters(onPage4, { sort: 'reviewed_at', order: 'asc' });
    expect(readPage(next)).toBe(1);
    expect(next.get('sort')).toBe('reviewed_at');
  });
  it('setFilters com page explícita respeita-a', () => {
    expect(readPage(withFilters(onPage4, { pageSize: '50', page: '2' }))).toBe(2);
  });
  it('filtro vazio é removido do URL', () => {
    expect(withFilter(onPage4, 'search', '').has('search')).toBe(false);
  });
});

describe('clampPage (limites e troca de produto)', () => {
  it('página dentro do intervalo não muda', () => {
    expect(clampPage(1, 7)).toBeNull();
    expect(clampPage(7, 7)).toBeNull();
  });
  it('?page=9 com 7 páginas → 7', () => {
    expect(clampPage(9, 7)).toBe(7);
  });
  it('produto UK (7 páginas) → BR com 1 página: página 7 → 1', () => {
    expect(clampPage(7, 1)).toBe(1);
  });
  it('lista vazia: página > 1 → 1; página 1 fica', () => {
    expect(clampPage(3, 0)).toBe(1);
    expect(clampPage(1, 0)).toBeNull();
  });
});
