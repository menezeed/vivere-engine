import { logger } from '../../lib/logger';
import { WordPressApiClient, fetchPostsSince, type WordPressPost } from './WordPressApiClient';
import { mapToRawActivityItems, type WordPressPostInput, type MapReviewReason } from './mapToRawActivityItems';
import { PREFEITURA_CABO_FRIO_CONFIG } from './config';
import type { RawActivityItem, ActivityCollectorError, ActivityCollectorResult } from '../../types/RawActivityItem';

export interface PrefeituraCollectorOptions {
  sinceDays?: number;   // sobrescreve config.since_days, útil para dry-run/teste
  maxPages?: number;    // sobrescreve config.max_pages
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

export class PrefeituraAgendaCulturalCollector {
  readonly sourceKey = PREFEITURA_CABO_FRIO_CONFIG.source_key;

  constructor(private readonly apiClient: WordPressApiClient) {}

  async collect(options: PrefeituraCollectorOptions = {}): Promise<ActivityCollectorResult> {
    const sinceDays = options.sinceDays ?? PREFEITURA_CABO_FRIO_CONFIG.since_days;
    const maxPages = options.maxPages ?? PREFEITURA_CABO_FRIO_CONFIG.max_pages;
    const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    logger.info(
      { sourceKey: this.sourceKey, sinceDays, sinceDate: sinceDate.toISOString(), maxPages },
      'iniciando coleta da Prefeitura de Cabo Frio',
    );

    const items: RawActivityItem[] = [];
    const errors: ActivityCollectorError[] = [];

    let postsFetched = 0;
    let postsServicoBlock = 0;
    let postsNarrativeFallback = 0;
    let postsAmbiguous = 0;
    let postsNoSchedule = 0;

    const pageGenerator = fetchPostsSince(this.apiClient, {
      categoryId: PREFEITURA_CABO_FRIO_CONFIG.category_id,
      sinceDate,
      perPage: PREFEITURA_CABO_FRIO_CONFIG.per_page,
      maxPages,
      delayMsBetweenPages: PREFEITURA_CABO_FRIO_CONFIG.delay_ms_between_pages,
    });

    for await (const postsInPage of pageGenerator) {
      for (const post of postsInPage) {
        postsFetched++;
        const input = wordPressPostToInput(post);
        const result = mapToRawActivityItems(input);

        if (result.extractionMethod === 'servico_block') postsServicoBlock++;
        // 'camada 2' conta toda TENTATIVA — sucesso, ambíguo ou not_found.
        // 'none' também conta aqui: é o caso em que a camada 1 não achou
        // o marcador SERVIÇO (logo, a camada 2 SEMPRE roda) e a camada 2
        // por sua vez não achou nenhuma data candidata (not_found) — a
        // tentativa de camada 2 ocorreu, só não produziu resultado.
        // Ambíguo e sem-data são subcategorias dentro do total de
        // tentativas da camada 2, não categorias concorrentes a ela.
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
        postsFetched,
        postsServicoBlock,
        postsNarrativeFallback,
        postsAmbiguous,
        postsNoSchedule,
        itemsReturned: items.length,
        itemsNeedingReview: itemsNeedingReview.length,
      },
      'coleta da Prefeitura de Cabo Frio finalizada',
    );

    return {
      items,
      errors,
      stats: {
        posts_fetched: postsFetched,
        posts_rejected_by_relevance: 0, // reservado para uso futuro do relevanceClassifier, ainda não conectado
        posts_parsed_servico_block: postsServicoBlock,
        posts_parsed_narrative_fallback: postsNarrativeFallback,
        posts_no_extractable_schedule: postsNoSchedule,
        items_returned: items.length,
      },
    };
  }
}
