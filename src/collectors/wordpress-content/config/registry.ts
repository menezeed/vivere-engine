/**
 * src/collectors/wordpress-content/config/registry.ts
 *
 * Level 2, 2026-09-26 — Entity Resolution territorial context.
 *
 * AVAILABLE_INSTANCES extraído de scripts/ingest-wordpress-content.ts
 * para src/ — única fonte de verdade das instâncias WordPress
 * configuradas, reutilizável tanto pela CLI de ingestão quanto pelo
 * Entity Resolution (via WordPressSourceTerritorialContextProvider),
 * sem duplicar nenhuma config.
 *
 * A indexação por INSTANCE KEY ('cabo-frio') é preservada
 * deliberadamente — tem semântica operacional da CLI, distinta da
 * semântica de identidade/proveniência de source_key
 * ('prefeitura_cabo_frio'). getWordPressSourceConfigBySourceKey()
 * deriva a segunda a partir da primeira, sem criar um segundo mapa
 * manual.
 */

import { CABO_FRIO_CONFIG } from './cabo-frio.js';
import { SAO_PEDRO_DA_ALDEIA_CONFIG } from './sao-pedro-da-aldeia.js';
import type { WordPressContentSourceConfig } from './WordPressContentSourceConfig.js';

export const AVAILABLE_INSTANCES: Record<string, WordPressContentSourceConfig> = {
  'cabo-frio': CABO_FRIO_CONFIG,
  'sao-pedro-da-aldeia': SAO_PEDRO_DA_ALDEIA_CONFIG,
};

/**
 * Constrói o índice source_key → config a partir de um mapa de
 * instâncias. Função pura, exportada separadamente do singleton lazy
 * abaixo — permite testar a detecção de duplicados com dados
 * sintéticos, sem depender nem corromper o estado real de
 * AVAILABLE_INSTANCES.
 *
 * Lança explicitamente se encontrar source_key duplicado entre
 * instâncias — mesmo padrão de fail-fast já usado em
 * entity-resolution/config/index.ts (validateERConfig, "falha
 * ruidosa intencional"). Nunca escolhe silenciosamente a primeira.
 */
export function buildSourceKeyIndex(
  instances: Record<string, WordPressContentSourceConfig>,
): Map<string, WordPressContentSourceConfig> {
  const index = new Map<string, WordPressContentSourceConfig>();
  for (const config of Object.values(instances)) {
    if (index.has(config.source_key)) {
      throw new Error(
        `registry.ts: source_key duplicado entre instâncias WordPress: "${config.source_key}" — ` +
        `cada instância declarada em AVAILABLE_INSTANCES deve ter um source_key único.`,
      );
    }
    index.set(config.source_key, config);
  }
  return index;
}

let sourceKeyIndex: Map<string, WordPressContentSourceConfig> | null = null;

/**
 * Resolve a WordPressContentSourceConfig completa a partir de um
 * source_key (ex: 'prefeitura_cabo_frio') — não da instance key da
 * CLI. Devolve null se nenhuma instância declarada tiver esse
 * source_key.
 */
export function getWordPressSourceConfigBySourceKey(
  sourceKey: string,
): WordPressContentSourceConfig | null {
  if (sourceKeyIndex === null) {
    sourceKeyIndex = buildSourceKeyIndex(AVAILABLE_INSTANCES);
  }
  return sourceKeyIndex.get(sourceKey) ?? null;
}
