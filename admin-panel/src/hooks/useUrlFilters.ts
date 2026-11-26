import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { readFilters, readPage, withFilter, withFilters, withPage } from './urlFilterParams';

/**
 * Sincronização bidirecional entre filtros e URL.
 *
 * URL → estado: ao carregar a página com ?city=Cabo+Frio, o filtro
 *               está activo imediatamente.
 * Estado → URL: ao alterar um filtro, a URL é actualizada sem reload.
 *
 * Genérico: funciona para venues, activities, sources, products, etc.
 * O chamador define quais keys existem — este hook não conhece nenhuma.
 *
 * `page` é lida directamente do URL (Issue #60): não precisa de estar nos
 * defaults. `resetPageOn` (ex.: o product_key) volta à página 1 quando muda.
 * A lógica de URL está em urlFilterParams.ts (testada).
 */
export function useUrlFilters<T extends Record<string, string | undefined>>(
  defaults: T,
  options: { resetPageOn?: unknown } = {},
) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Lê o estado actual da URL, aplicando defaults para chaves ausentes
  const filters = useMemo<T>(
    () => readFilters(searchParams, defaults),
    [searchParams], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Actualiza um filtro na URL (filtros que não sejam 'page' voltam à página 1)
  const setFilter = useCallback((key: keyof T | 'page', value: string | undefined) => {
    setSearchParams(prev => withFilter(prev, key as string, value), { replace: true });
  }, [setSearchParams]);

  // Actualiza múltiplos filtros de uma vez
  const setFilters = useCallback((updates: Partial<T> & { page?: string }) => {
    setSearchParams(prev => withFilters(prev, updates as Record<string, string | undefined>), { replace: true });
  }, [setSearchParams]);

  // Limpa todos os filtros (volta aos defaults)
  const clearFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const page = readPage(searchParams);
  const setPage = useCallback((p: number) => {
    setSearchParams(prev => withPage(prev, p), { replace: true });
  }, [setSearchParams]);

  // Troca de produto (ou outra chave externa ao URL) → página 1.
  const lastReset = useRef(options.resetPageOn);
  useEffect(() => {
    if (Object.is(lastReset.current, options.resetPageOn)) return;
    lastReset.current = options.resetPageOn;
    setPage(1);
  }, [options.resetPageOn, setPage]);

  return { filters, setFilter, setFilters, clearFilters, page, setPage };
}
