/**
 * Dry-run do PrefeituraAgendaCulturalCollector — categoria Cultura
 * (id=73), Cabo Frio / RJ.
 *
 * Faz chamadas HTTP REAIS contra a WordPress REST API da Prefeitura
 * (sem custo monetário, mas com tráfego de rede real — respeita o
 * delay entre páginas configurado para boa cidadania).
 *
 * O QUE ESTE SCRIPT FAZ:
 * - Busca posts reais da categoria Cultura dos últimos N dias
 * - Aplica o extrator de duas camadas (bloco SERVIÇO + narrativo)
 * - Imprime cada RawActivityItem resultante, com raw_payload completo
 * - Imprime contagens por: posts lidos, posts com camada 1, posts
 *   com camada 2, posts ambíguos, itens gerados, itens que precisam
 *   revisão
 *
 * O QUE ESTE SCRIPT NUNCA FAZ:
 * - Não escreve em staging.venues_staging nem staging.activities_staging
 * - Não acessa nenhuma tabela staging.* ou public.* do Supabase
 * - Não chama nenhuma função de promoção
 * - Não importa nenhum cliente Supabase, sequer indiretamente
 *
 * Uso:
 *   npx tsx scripts/dry-run-prefeitura-cabo-frio.ts
 *   npx tsx scripts/dry-run-prefeitura-cabo-frio.ts --since-days=7   (janela menor, para teste rápido)
 *   npx tsx scripts/dry-run-prefeitura-cabo-frio.ts --max-pages=2     (limite de páginas menor)
 */

import { WordPressApiClient } from '../src/collectors/prefeitura-agenda-cultural/WordPressApiClient';
import { PrefeituraAgendaCulturalCollector } from '../src/collectors/prefeitura-agenda-cultural/PrefeituraAgendaCulturalCollector';
import { PREFEITURA_CABO_FRIO_CONFIG } from '../src/collectors/prefeitura-agenda-cultural/config';
import type { MapReviewReason } from '../src/collectors/prefeitura-agenda-cultural/mapToRawActivityItems';

function parseArgValue(flag: string): number | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? Number(arg.split('=')[1]) : undefined;
}

async function main() {
  const sinceDays = parseArgValue('since-days') ?? PREFEITURA_CABO_FRIO_CONFIG.since_days;
  const maxPages = parseArgValue('max-pages') ?? PREFEITURA_CABO_FRIO_CONFIG.max_pages;

  console.log('--- DRY RUN: PrefeituraAgendaCulturalCollector — Cabo Frio / RJ ---');
  console.log(`Fonte: ${PREFEITURA_CABO_FRIO_CONFIG.base_url} (categoria Cultura, id=${PREFEITURA_CABO_FRIO_CONFIG.category_id})`);
  console.log(`Janela: últimos ${sinceDays} dias | Limite de páginas: ${maxPages}`);
  console.log('Nenhuma escrita em staging ou produção ocorrerá nesta execução.\n');

  const apiClient = new WordPressApiClient(PREFEITURA_CABO_FRIO_CONFIG.base_url);
  const collector = new PrefeituraAgendaCulturalCollector(apiClient);

  const result = await collector.collect({ sinceDays, maxPages });

  console.log('\n=== ITENS GERADOS ===\n');
  for (const item of result.items) {
    const reviewReasons = (item.raw_payload.review_reasons as MapReviewReason[] | undefined) ?? [];
    const needsReview = reviewReasons.length > 0;

    console.log(`${needsReview ? '⚠ ' : '✓ '}${item.title}`);
    console.log(`  método: ${item.raw_payload.extraction_method} | confiança: ${item.raw_payload.extraction_confidence}`);
    console.log(`  ocorrência: ${item.occurrences.length > 0 ? JSON.stringify(item.occurrences[0]) : '(nenhuma data extraída)'}`);
    console.log(`  venue: ${item.venue_mention?.raw_text ?? '(não extraído)'}`);
    console.log(`  url: ${item.external_url}`);
    if (needsReview) {
      console.log(`  revisão necessária: ${reviewReasons.join(', ')}`);
    }
    console.log('');
  }

  if (result.errors.length > 0) {
    console.log('\n=== POSTS SEM ITEM GERADO (ambíguos ou sem programação extraível) ===\n');
    for (const err of result.errors) {
      console.log(`  - ${err.message}`);
    }
  }

  const itemsNeedingReview = result.items.filter((item) => {
    const reasons = (item.raw_payload.review_reasons as MapReviewReason[] | undefined) ?? [];
    return reasons.length > 0;
  });

  console.log('\n=== CONTAGENS ===');
  console.log(`Posts lidos:                      ${result.stats.posts_fetched}`);
  console.log(`Posts extraídos via camada 1 (SERVIÇO): ${result.stats.posts_parsed_structured_block}`);
  console.log(`Posts processados via camada 2 (narrativa, toda tentativa): ${result.stats.posts_parsed_narrative_fallback}`);
  console.log(`  dos quais sem programação extraível: ${result.stats.posts_no_extractable_schedule}`);
  console.log(`Itens gerados (RawActivityItem):  ${result.stats.items_returned}`);
  console.log(`Itens que precisam de revisão:    ${itemsNeedingReview.length}`);

  console.log('\nNenhuma escrita em staging.venues_staging, staging.activities_staging, public.venues ou public.activities foi realizada.');
}

main().catch((err) => {
  console.error('Dry-run falhou:', err);
  process.exit(1);
});
