/**
 * src/lib/resolveRegionFilter.ts
 *
 * Lógica de filtro de região dos scripts de Google Places, extraída
 * para módulo único e partilhado. Antes desta extração, a mesma regra
 * estava duplicada em dry-run-google-places.ts e
 * ingest-google-places.ts — quando um foi corrigido, o outro ficou
 * para trás (bug real, Fase 9, execução real do Brooklin). Esta função
 * elimina a classe inteira desse problema: só existe um lugar onde a
 * regra "region_key → productConfig filtrado" está escrita.
 *
 * Pura — sem I/O, sem process.exit, sem logger. Cada script decide o
 * que fazer com o resultado (imprimir erro e sair, ou continuar).
 * Genérica — funciona para qualquer productConfig com um array
 * `regions` de objetos com `key`, não específica de nenhum produto ou
 * região.
 */

export interface RegionLike {
  readonly key: string;
}

export interface ProductConfigWithRegions<TRegion extends RegionLike> {
  readonly regions: readonly TRegion[];
}

export type RegionFilterResult<T> =
  | { readonly ok: true; readonly config: T }
  | { readonly ok: false; readonly error: string; readonly available: readonly string[] };

/**
 * Resolve o productConfig efetivo a partir de um --region= opcional.
 *
 * - regionKey ausente/undefined → devolve o productConfig original,
 *   sem alteração (todas as regiões, comportamento pré-existente).
 * - regionKey presente e encontrado → devolve uma cópia do
 *   productConfig com `regions` reduzido a exatamente essa região.
 * - regionKey presente e não encontrado → ok:false, com a lista de
 *   region_keys disponíveis para a mensagem de erro do chamador.
 */
export function resolveRegionFilter<
  TRegion extends RegionLike,
  TConfig extends ProductConfigWithRegions<TRegion>,
>(productConfig: TConfig, regionKey: string | undefined): RegionFilterResult<TConfig> {
  if (!regionKey) {
    return { ok: true, config: productConfig };
  }

  const matchedRegion = productConfig.regions.find((r) => r.key === regionKey);

  if (!matchedRegion) {
    return {
      ok: false,
      error: `Região "${regionKey}" não encontrada. Disponíveis: ${productConfig.regions.map((r) => r.key).join(', ')}`,
      available: productConfig.regions.map((r) => r.key),
    };
  }

  return { ok: true, config: { ...productConfig, regions: [matchedRegion] } };
}
