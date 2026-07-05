import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Sincronização bidirecional entre filtros e URL.
 *
 * URL → estado: ao carregar a página com ?city=Cabo+Frio, o filtro
 *               está activo imediatamente.
 * Estado → URL: ao alterar um filtro, a URL é actualizada sem reload.
 *
 * Genérico: funciona para venues, activities, sources, products, etc.
 * O chamador define quais keys existem — este hook não conhece nenhuma.
 */
export function useUrlFilters<T extends Record<string, string | undefined>>(defaults: T) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Lê o estado actual da URL, aplicando defaults para chaves ausentes
  const filters = useMemo<T>(() => {
    const result = { ...defaults } as T;
    for (const key of Object.keys(defaults)) {
      const val = searchParams.get(key);
      if (val !== null) {
        (result as Record<string, string | undefined>)[key] = val;
      }
    }
    return result;
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Actualiza um ou mais filtros na URL
  const setFilter = useCallback((key: keyof T, value: string | undefined) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value === undefined || value === '') {
        next.delete(key as string);
      } else {
        next.set(key as string, value);
      }
      // Resetar página ao alterar qualquer filtro que não seja 'page'
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Actualiza múltiplos filtros de uma vez
  const setFilters = useCallback((updates: Partial<T>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') {
          next.delete(key);
        } else {
          next.set(key, value as string);
        }
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Limpa todos os filtros (volta aos defaults)
  const clearFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Conveniência: valor de page como número
  const page = Number(filters['page'] ?? '1');
  const setPage = useCallback((p: number) => {
    setFilter('page' as keyof T, p === 1 ? undefined : String(p));
  }, [setFilter]);

  return { filters, setFilter, setFilters, clearFilters, page, setPage };
}
