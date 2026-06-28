import { logger } from '../../lib/logger';
import { WordPressApiClient, fetchPostsSince, type WordPressPost } from './WordPressApiClient';
import { mapToRawActivityItems, type WordPressPostInput, type MapReviewReason } from './mapToRawActivityItems';
import type { WordPressContentSourceConfig } from './config/WordPressContentSourceConfig';
import type { RawActivityItem, ActivityCollectorError, ActivityCollectorResult } from '../../types/RawActivityItem';

/**
 * Collector genérico para fontes WordPress que publicam programação
 * cultural/institucional em texto livre, com ou sem bloco estruturado
 * (SERVIÇO:/PROGRAMAÇÃO:/AGENDA:/INFORMAÇÕES:, configurável).
 *
 * Esta classe NUNCA importa nem conhece nenhuma instância específica
 * (Cabo Frio, Araruama, etc.) — ela recebe a configuração completa da
 * instância via construtor. Cada prefeitura/organização real é um
 * arquivo em config/ implementando WordPressContentSourceConfig,
 * instanciado por quem monta o registry de Collectors da plataforma,
 * nunca importado aqui dentro do motor.
 */
export interface WordPressContentCollectorOptions {
  sinceDays?: number;   // sobrescreve sourceConfig.since_days, útil para dry-run/teste
  maxPages?: number;    // sobrescreve sourceConfig.max_pages
}

function wordPressPostToInput(post: WordPressPost): WordPressPostInput {
  const publishedDate = new Date(post.date_gmt);
  return {
    id: post.id,
    title: post.title.rendered,
    contentHtml: post.content.rendered,
    link: post.link,
    publishedAt: {
      year: publishedDate.getUTCFullYear(),
      month: publishedDate.getUTCMonth() + 1,
      isoDate: post.date_gmt,
    },
    imageUrl: post.yoast_head_json?.og_image?.[0]?.url ?? null,
  };
}

export class WordPressContentCollector {
  readonly sourceKey: string;

  constructor(
    private readonly apiClient: WordPressApiClient,
    private readonly sourceConfig: WordPressContentSourceConfig,
  ) {
    this.sourceKey = sourceConfig.source_key;
  }

  async collect(options: WordPressContentCollectorOptions = {}): Promise<ActivityCollectorResult> {
    const sinceDays = options.sinceDays ?? this.sourceConfig.since_days;
    const maxPages = options.maxPages ?? this.sourceConfig.max_pages;
    const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    logger.info(
      {
        sourceKey: this.sourceKey,
        displayName: this.sourceConfig.display_name,
        productKey: this.sourceConfig.product_key,
        sinceDays,
        sinceDate: sinceDate.toISOString(),
        maxPages,
      },
      'iniciando coleta WordPress',
    );

    const items: RawActivityItem[] = [];
    const errors: ActivityCollectorError[] = [];

    let postsFetched = 0;
    let postsStructuredBlock = 0;
    let postsNarrativeFallback = 0;
    let postsAmbiguous = 0;
    let postsNoSchedule = 0;

    const pageGenerator = fetchPostsSince(this.apiClient, {
      categoryId: this.sourceConfig.category_id,
      sinceDate,
      perPage: this.sourceConfig.per_page,
      maxPages,
      delayMsBetweenPages: this.sourceConfig.delay_ms_between_pages,
    });

    for await (const postsInPage of pageGenerator) {
      for (const post of postsInPage) {
        postsFetched++;
        const input = wordPressPostToInput(post);
        const result = mapToRawActivityItems(input, {
          source_key: this.sourceConfig.source_key,
          structured_block_marker: this.sourceConfig.structured_block_marker,
        });

        if (result.extractionMethod === 'structured_block') postsStructuredBlock++;
        // 'camada 2' conta toda TENTATIVA — sucesso, ambíguo ou not_found.
        // 'none' também conta aqui: é o caso em que a camada 1 não achou
        // o marcador configurado (logo, a camada 2 SEMPRE roda) e a
        // camada 2 por sua vez não achou nenhuma data candidata
        // (not_found) — a tentativa de camada 2 ocorreu, só não
        // produziu resultado. Ambíguo e sem-data são subcategorias
        // dentro do total de tentativas da camada 2, não categorias
        // concorrentes a ela.
        if (result.extractionMethod === 'narrative_fallback' || result.extractionMethod === 'none') {
          postsNarrativeFallback++;
        }

        for (const skip of result.skipped) {
          if (skip.reason === 'narrative_ambiguous') postsAmbiguous++;
          if (skip.reason === 'no_extractable_schedule_found') postsNoSchedule++;

          errors.push({
            source_item_id: String(post.id),
            message: `${skip.reason}: ${skip.context}`,
            raw_context: { wp_post_id: post.id, extraction_method: result.extractionMethod },
          });
        }

        items.push(...result.items);
      }
    }

    const itemsNeedingReview = items.filter((item) => {
      const reasons = (item.raw_payload.review_reasons as MapReviewReason[] | undefined) ?? [];
      return reasons.length > 0;
    });

    logger.info(
      {
        sourceKey: this.sourceKey,
        postsFetched,
        postsStructuredBlock,
        postsNarrativeFallback,
        postsAmbiguous,
        postsNoSchedule,
        itemsReturned: items.length,
        itemsNeedingReview: itemsNeedingReview.length,
      },
      'coleta WordPress finalizada',
    );

    return {
      items,
      errors,
      stats: {
        posts_fetched: postsFetched,
        posts_rejected_by_relevance: 0, // reservado para uso futuro do relevanceClassifier, ainda não conectado
        posts_parsed_structured_block: postsStructuredBlock,
        posts_parsed_narrative_fallback: postsNarrativeFallback,
        posts_no_extractable_schedule: postsNoSchedule,
        items_returned: items.length,
      },
    };
  }
}
