/**
 * Dry-run do WordPressContentCollector — genérico, funciona com
 * qualquer instância configurada em config/.
 *
 * O script em si NUNCA menciona "Cabo Frio" como lógica — ele só
 * importa a config selecionada via argumento de linha de comando
 * e a passa ao motor. Adicionar uma nova prefeitura/organização não
 * exige tocar neste arquivo, só criar um novo config/<nome>.ts.
 *
 * Uso:
 *   npx tsx scripts/dry-run-wordpress-content.ts                    (usa cabo-frio por default)
 *   npx tsx scripts/dry-run-wordpress-content.ts --instance=cabo-frio
 *   npx tsx scripts/dry-run-wordpress-content.ts --instance=araruama --since-days=7 --max-pages=2
 *
 * O QUE ESTE SCRIPT NUNCA FAZ:
 * - Não escreve em staging.* ou public.* do Supabase
 * - Não chama nenhuma função de promoção
 */

import { WordPressApiClient } from '../src/collectors/wordpress-content/WordPressApiClient';
import { WordPressContentCollector } from '../src/collectors/wordpress-content/WordPressContentCollector';
import { CABO_FRIO_CONFIG } from '../src/collectors/wordpress-content/config/cabo-frio';
import { ARARUAMA_CONFIG } from '../src/collectors/wordpress-content/config/araruama';
import type { WordPressContentSourceConfig } from '../src/collectors/wordpress-content/config/WordPressContentSourceConfig';
import type { MapReviewReason } from '../src/collectors/wordpress-content/mapToRawActivityItems';

const AVAILABLE_INSTANCES: Record<string, WordPressContentSourceConfig> = {
  'cabo-frio': CABO_FRIO_CONFIG,
  araruama: ARARUAMA_CONFIG,
};

function parseArgValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.split('=')[1] : undefined;
}

async function main() {
  const instanceKey = parseArgValue('instance') ?? 'cabo-frio';
  const sourceConfig = AVAILABLE_INSTANCES[instanceKey];

  if (!sourceConfig) {
    console.error(`Instância "${instanceKey}" não encontrada. Disponíveis: ${Object.keys(AVAILABLE_INSTANCES).join(', ')}`);
    process.exit(1);
  }

  const sinceDays = Number(parseArgValue('since-days') ?? sourceConfig.since_days);
  const maxPages = Number(parseArgValue('max-pages') ?? sourceConfig.max_pages);

  console.log(`--- DRY RUN: WordPressContentCollector — instância "${instanceKey}" ---`);
  console.log(`Fonte: ${sourceConfig.display_name} (${sourceConfig.base_url}, categoria id=${sourceConfig.category_id})`);
  console.log(`Produto: ${sourceConfig.product_key} | source_priority: ${sourceConfig.source_priority}`);
  console.log(`Marcador de bloco configurado: ${sourceConfig.structured_block_marker}`);
  console.log(`Janela: últimos ${sinceDays} dias | Limite de páginas: ${maxPages}`);
  console.log('Nenhuma escrita em staging ou produção ocorrerá nesta execução.\n');

  const apiClient = new WordPressApiClient(sourceConfig.base_url);
  const collector = new WordPressContentCollector(apiClient, sourceConfig);

  const result = await collector.collect({ sinceDays, maxPages });

  console.log('\n=== ITENS GERADOS ===\n');
  for (const item of result.items) {
    const reviewReasons = (item.raw_payload.review_reasons as MapReviewReason[] | undefined) ?? [];
    const needsReview = reviewReasons.length > 0;

    console.log(`${needsReview ? '⚠ ' : '✓ '}${item.title}`);
    console.log(`  método: ${item.raw_payload.extraction_method} | confiança: ${item.raw_payload.extraction_confidence}`);
    console.log(`  ocorrência: ${item.occurrences.length > 0 ? JSON.stringify(item.occurrences[0]) : '(nenhuma data extraída)'}`);
    console.log(
      `  venue: ${item.venue_mention?.raw_text ?? '(não extraído)'}${item.venue_mention ? ` [${item.venue_mention.confidence_hint}]` : ''}`,
    );
    console.log(`  url: ${item.external_url}`);
    if (needsReview) {
      console.log(`  revisão necessária: ${reviewReasons.join(', ')}`);
    }
    console.log('');
  }

  if (result.errors.length > 0) {
    console.log('\n=== POSTS SEM ITEM GERADO ===\n');
    for (const err of result.errors) {
      console.log(`  - ${err.message}`);
    }
  }

  console.log('\n=== CONTAGENS ===');
  console.log(`Posts lidos: ${result.stats.posts_fetched}`);
  console.log(`Posts via camada 1 (bloco estruturado): ${result.stats.posts_parsed_structured_block}`);
  console.log(`Posts via camada 2 (narrativa, toda tentativa): ${result.stats.posts_parsed_narrative_fallback}`);
  console.log(`Itens gerados: ${result.stats.items_returned}`);

  console.log('\nNenhuma escrita em staging.* ou public.* foi realizada.');
}

main().catch((err) => {
  console.error('Dry-run falhou:', err);
  process.exit(1);
});
