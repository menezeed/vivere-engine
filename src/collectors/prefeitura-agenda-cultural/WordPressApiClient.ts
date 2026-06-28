import { withRetry } from '../../lib/retry';
import { logger } from '../../lib/logger';

/**
 * Cliente genérico da WordPress REST API. Deliberadamente não
 * acoplado a Cabo Frio — qualquer site .gov.br em WordPress (comum
 * no Brasil) pode reutilizar este cliente passando outra baseUrl.
 *
 * Paginação: usa o parâmetro nativo `page` da WP REST API e lê o
 * header `X-WP-TotalPages` para saber quando parar, em vez de
 * adivinhar ou continuar até receber uma página vazia.
 */

export interface WordPressPost {
  id: number;
  date: string;       // ISO local, ex: "2026-06-25T11:17:54"
  date_gmt: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  categories: number[];
  yoast_head_json?: {
    og_image?: Array<{ url: string }>;
  };
}

export interface FetchPostsParams {
  categoryId: number;
  page: number;
  perPage: number;
}

export interface FetchPostsResult {
  posts: WordPressPost[];
  totalPages: number;
}

export class WordPressApiClient {
  constructor(private readonly baseUrl: string) {
    if (!baseUrl) {
      throw new Error('WordPressApiClient requer uma baseUrl válida');
    }
  }

  async fetchPosts(params: FetchPostsParams): Promise<FetchPostsResult> {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2/posts`);
    url.searchParams.set('categories', String(params.categoryId));
    url.searchParams.set('page', String(params.page));
    url.searchParams.set('per_page', String(params.perPage));

    const response = await withRetry(
      () => fetch(url.toString()),
      { maxAttempts: 3, baseDelayMs: 1000 },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WordPress REST API falhou (${response.status}) em ${url.toString()}: ${text}`);
    }

    const totalPagesHeader = response.headers.get('X-WP-TotalPages');
    const totalPages = totalPagesHeader ? Number(totalPagesHeader) : 1;
    const posts = (await response.json()) as WordPressPost[];

    return { posts, totalPages };
  }
}

/**
 * Generator assíncrono que pagina a categoria inteira, parando
 * assim que encontra um post mais antigo que `sinceDate` — a API do
 * WordPress retorna posts em ordem cronológica decrescente por
 * padrão, então o primeiro post fora da janela implica que todos os
 * posts subsequentes também estarão fora, sem necessidade de
 * verificar o restante.
 *
 * `maxPages` é o limite de segurança absoluto: mesmo que `sinceDate`
 * nunca seja alcançado (ex: bug de data, ou categoria com posts
 * futuros mal configurados), a paginação nunca excede esse teto.
 */
export async function* fetchPostsSince(
  client: WordPressApiClient,
  options: { categoryId: number; sinceDate: Date; perPage: number; maxPages: number; delayMsBetweenPages: number },
): AsyncGenerator<WordPressPost[]> {
  let page = 1;
  let totalPages = 1;

  do {
    const { posts, totalPages: tp } = await client.fetchPosts({
      categoryId: options.categoryId,
      page,
      perPage: options.perPage,
    });
    totalPages = tp;

    logger.info(
      { page, totalPages, postsInPage: posts.length },
      'página de posts da WordPress REST API recebida',
    );

    const postsWithinWindow = posts.filter((p) => new Date(p.date_gmt) >= options.sinceDate);
    yield postsWithinWindow;

    // Se algum post desta página já está fora da janela, todos os
    // posts das páginas seguintes também estarão (ordem cronológica
    // decrescente) — para a paginação aqui, sem esgotar maxPages.
    const hitOlderThanWindow = postsWithinWindow.length < posts.length;
    if (hitOlderThanWindow) {
      logger.info({ page }, 'janela de tempo (since) atingida, interrompendo paginação');
      break;
    }

    page++;

    if (page > options.maxPages) {
      logger.warn(
        { maxPages: options.maxPages },
        'limite de segurança de páginas atingido antes de esgotar a janela de tempo ou a categoria',
      );
      break;
    }

    if (options.delayMsBetweenPages > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMsBetweenPages));
    }
  } while (page <= totalPages);
}
