/**
 * Lógica pura de filtros ↔ URL usada por useUrlFilters (Issue #60).
 * Sem React, para ser testada pelo Vitest da raiz.
 *
 * Regra: `page` é SEMPRE lida directamente do URL — nunca depende de o
 * chamador incluir `page` nos defaults (era essa a causa do bug: as páginas
 * não incluíam `page`, `filters.page` ficava undefined e a página era sempre 1).
 */
export const PAGE_PARAM = 'page';

/** Página actual a partir do URL. Inválida, ausente ou < 1 → 1. */
export function readPage(params: URLSearchParams): number {
  const raw = params.get(PAGE_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) return 1;
  const n = Number(raw);
  return n >= 1 ? n : 1;
}

/** Filtros a partir do URL, com os defaults para as chaves ausentes. */
export function readFilters<T extends Record<string, string | undefined>>(
  params: URLSearchParams, defaults: T,
): T {
  const result = { ...defaults } as Record<string, string | undefined>;
  for (const key of Object.keys(defaults)) {
    const val = params.get(key);
    if (val !== null) result[key] = val;
  }
  return result as T;
}

function put(next: URLSearchParams, key: string, value: string | undefined): void {
  if (value === undefined || value === '') next.delete(key);
  else next.set(key, value);
}

/** Muda um filtro. Qualquer filtro que não seja `page` volta à página 1. */
export function withFilter(prev: URLSearchParams, key: string, value: string | undefined): URLSearchParams {
  const next = new URLSearchParams(prev);
  put(next, key, value);
  if (key !== PAGE_PARAM) next.delete(PAGE_PARAM);
  return next;
}

/**
 * Muda vários filtros. Se algum deles não for `page`, volta à página 1
 * (a menos que o próprio update traga `page`).
 */
export function withFilters(prev: URLSearchParams, updates: Record<string, string | undefined>): URLSearchParams {
  const next = new URLSearchParams(prev);
  const keys = Object.keys(updates);
  for (const key of keys) put(next, key, updates[key]);
  if (keys.some(k => k !== PAGE_PARAM) && !keys.includes(PAGE_PARAM)) next.delete(PAGE_PARAM);
  return next;
}

/** Vai para a página p (p ≤ 1 remove o parâmetro). Mantém todos os outros filtros. */
export function withPage(prev: URLSearchParams, p: number): URLSearchParams {
  const next = new URLSearchParams(prev);
  const page = Number.isFinite(p) ? Math.floor(p) : 1;
  if (page <= 1) next.delete(PAGE_PARAM);
  else next.set(PAGE_PARAM, String(page));
  return next;
}

/**
 * Página fora do intervalo devolvido pela API (ex.: ?page=9 com 7 páginas,
 * ou depois de trocar de produto) → página válida mais próxima.
 * Devolve null quando não é preciso corrigir.
 */
export function clampPage(page: number, totalPages: number): number | null {
  if (totalPages < 1) return page > 1 ? 1 : null;
  if (page > totalPages) return totalPages;
  return null;
}
