/**
 * entity-resolution/pipeline/WordPressSourceTerritorialContextProvider.ts
 *
 * Implementação concreta de ISourceTerritorialContextProvider para
 * fontes WordPress (Level 2, 2026-09-26).
 *
 * Consome getWordPressSourceConfigBySourceKey() do registry
 * compartilhado (src/collectors/wordpress-content/config/registry.ts)
 * — a mesma fonte de verdade já usada pela CLI de ingestão. Nenhum
 * mapa duplicado.
 *
 * O EntityResolutionEngine nunca importa este arquivo directamente
 * por nome de collector — conhece apenas ISourceTerritorialContextProvider.
 * Esta implementação concreta é injectada no ponto de composição
 * (run.ts), não no Engine.
 */

import type { ISourceTerritorialContextProvider } from '../interfaces/providers.js';
import type { TrustedCityContext } from '../types/domain.js';
import { getWordPressSourceConfigBySourceKey } from '../../collectors/wordpress-content/config/registry.js';

export class WordPressSourceTerritorialContextProvider implements ISourceTerritorialContextProvider {
  readonly id = 'wordpress-source-territorial-context';

  /**
   * Resolve o contexto territorial de um source_key via o registry
   * WordPress. Devolve null quando:
   *   — o source_key não corresponde a nenhuma instância registada;
   *   — a instância existe mas não declara region_metadata.
   * Nunca lança, nunca infere.
   */
  getCityContext(sourceKey: string): TrustedCityContext | null {
    const config = getWordPressSourceConfigBySourceKey(sourceKey);
    if (!config?.region_metadata?.city || !config.region_metadata.state) {
      return null;
    }
    return {
      city:  config.region_metadata.city,
      state: config.region_metadata.state,
    };
  }
}
