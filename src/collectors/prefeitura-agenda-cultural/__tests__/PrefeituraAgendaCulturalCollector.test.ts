import { describe, it, expect, vi } from 'vitest';
import { PrefeituraAgendaCulturalCollector } from '../PrefeituraAgendaCulturalCollector';
import type { WordPressApiClient, WordPressPost, FetchPostsResult, FetchPostsParams } from '../WordPressApiClient';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function makeFakeClient(postsByPage: WordPressPost[][]): WordPressApiClient {
  let callCount = 0;
  return {
    fetchPosts: vi.fn(async (_params: FetchPostsParams): Promise<FetchPostsResult> => {
      const page = postsByPage[callCount] ?? [];
      callCount++;
      return { posts: page, totalPages: postsByPage.length };
    }),
  } as unknown as WordPressApiClient;
}

function makePost(overrides: Partial<WordPressPost>): WordPressPost {
  return {
    id: 1,
    date: daysAgo(1),
    date_gmt: daysAgo(1),
    link: 'https://noticias.cabofrio.rj.gov.br/post',
    title: { rendered: 'Post de teste' },
    content: { rendered: '<p>conteúdo</p>' },
    categories: [73],
    ...overrides,
  };
}

describe('PrefeituraAgendaCulturalCollector — integração sem rede real', () => {
  it('processa posts dentro da janela de since e gera RawActivityItem corretamente', async () => {
    const client = makeFakeClient([
      [
        makePost({
          id: 1,
          date_gmt: daysAgo(2),
          title: { rendered: 'Yoga no Forte' },
          content: {
            rendered:
              '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga no Forte</strong><br>Dia: 28 de junho de 2026<br>Horário: 7h às 8h<br>Local: Canto do Forte</p>',
          },
        }),
      ],
    ]);

    const collector = new PrefeituraAgendaCulturalCollector(client);
    const result = await collector.collect({ sinceDays: 30, maxPages: 5 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Yoga no Forte');
    expect(result.stats.posts_fetched).toBe(1);
  });

  it('exclui posts mais antigos que a janela de since, e nunca os processa', async () => {
    const client = makeFakeClient([
      [
        makePost({ id: 1, date_gmt: daysAgo(2) }),       // dentro da janela
        makePost({ id: 2, date_gmt: daysAgo(40) }),       // fora da janela
      ],
    ]);

    const collector = new PrefeituraAgendaCulturalCollector(client);
    const result = await collector.collect({ sinceDays: 30, maxPages: 5 });

    expect(result.stats.posts_fetched).toBe(1); // só o post dentro da janela é contado
    expect(result.errors.some((e) => e.source_item_id === '2')).toBe(false);
  });

  it('para a paginação assim que encontra um post fora da janela, sem buscar páginas seguintes', async () => {
    const client = makeFakeClient([
      [makePost({ id: 1, date_gmt: daysAgo(2) }), makePost({ id: 2, date_gmt: daysAgo(40) })],
      [makePost({ id: 3, date_gmt: daysAgo(50) })], // não deveria nunca ser buscada
    ]);

    const collector = new PrefeituraAgendaCulturalCollector(client);
    await collector.collect({ sinceDays: 30, maxPages: 5 });

    expect(client.fetchPosts).toHaveBeenCalledTimes(1); // só a primeira página foi buscada
  });

  it('respeita o limite de segurança maxPages mesmo se a janela de tempo nunca for atingida', async () => {
    const allRecentPosts = Array.from({ length: 5 }, (_, i) =>
      [makePost({ id: i + 1, date_gmt: daysAgo(1) })], // todos sempre dentro da janela
    );
    const client = makeFakeClient(allRecentPosts);

    const collector = new PrefeituraAgendaCulturalCollector(client);
    await collector.collect({ sinceDays: 30, maxPages: 3 });

    expect(client.fetchPosts).toHaveBeenCalledTimes(3); // parou no limite de segurança, não nas 5 páginas disponíveis
  });

  it('contabiliza estatísticas por camada corretamente (servico_block, narrative_fallback, ambíguo, sem-data)', async () => {
    const client = makeFakeClient([
      [
        makePost({
          id: 1,
          content: {
            rendered:
              '<p><strong>SERVIÇO:</strong></p><p><strong>Evento A</strong><br>Dia: 1 de julho de 2026<br>Horário: 10h<br>Local: Praça</p>',
          },
        }),
        makePost({
          id: 2,
          title: { rendered: 'Show no Centro Cultural' },
          content: { rendered: '<p>Neste domingo (28) acontece um show no Centro Cultural. A partir das 19h.</p>' },
        }),
        makePost({
          id: 3,
          title: { rendered: 'Forte São Mateus' },
          content: { rendered: '<p>Nesta sexta-feira (19) e no sábado (20), o Forte recebe um evento. A partir das 16h.</p>' },
        }),
        makePost({
          id: 4,
          title: { rendered: 'Edital' },
          content: { rendered: '<p>A Secretaria de Cultura anuncia novo edital de fomento.</p>' },
        }),
      ],
    ]);

    const collector = new PrefeituraAgendaCulturalCollector(client);
    const result = await collector.collect({ sinceDays: 30, maxPages: 5 });

    expect(result.stats.posts_fetched).toBe(4);
    expect(result.stats.posts_parsed_servico_block).toBe(1);
    expect(result.stats.posts_parsed_narrative_fallback).toBe(3); // sucesso + ambíguo + not_found, todas tentativas
    expect(result.stats.items_returned).toBe(2); // post 1 (servico) + post 2 (narrativa sucesso); 3 e 4 não geram item
  });

  it('preserva raw_payload com extraction_method, extraction_confidence e review_reasons em cada item', async () => {
    const client = makeFakeClient([
      [
        makePost({
          id: 1,
          content: {
            rendered:
              '<p><strong>SERVIÇO:</strong></p><p><strong>Evento Teste</strong><br>Dia: 1 de julho de 2026<br>Horário: 10h</p>',
          },
        }),
      ],
    ]);

    const collector = new PrefeituraAgendaCulturalCollector(client);
    const result = await collector.collect({ sinceDays: 30, maxPages: 5 });

    const [item] = result.items;
    expect(item.raw_payload.extraction_method).toBe('servico_block');
    expect(item.raw_payload.extraction_confidence).toBe(0.9);
    expect(item.raw_payload.review_reasons).toBeDefined();
    expect(item.raw_payload.raw_text).toBeDefined();
  });

  it('registra posts ambíguos e sem programação extraível em errors[], nunca em items[]', async () => {
    const client = makeFakeClient([
      [
        makePost({
          id: 1,
          title: { rendered: 'Forte São Mateus' },
          content: { rendered: '<p>Nesta sexta-feira (19) e no sábado (20), evento. A partir das 16h.</p>' },
        }),
      ],
    ]);

    const collector = new PrefeituraAgendaCulturalCollector(client);
    const result = await collector.collect({ sinceDays: 30, maxPages: 5 });

    expect(result.items).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('narrative_ambiguous');
  });

  it('resolve image_url a partir de yoast_head_json.og_image sem nenhuma chamada HTTP adicional', async () => {
    const client = makeFakeClient([
      [
        makePost({
          id: 1,
          content: {
            rendered:
              '<p><strong>SERVIÇO:</strong></p><p><strong>Evento Teste</strong><br>Dia: 1 de julho de 2026<br>Horário: 10h</p>',
          },
          yoast_head_json: { og_image: [{ url: 'https://example.com/imagem.jpg' }] },
        }),
      ],
    ]);

    const collector = new PrefeituraAgendaCulturalCollector(client);
    const result = await collector.collect({ sinceDays: 30, maxPages: 5 });

    expect(result.items[0].image_url).toBe('https://example.com/imagem.jpg');
    expect(client.fetchPosts).toHaveBeenCalledTimes(1); // nenhuma chamada extra de media
  });
});
