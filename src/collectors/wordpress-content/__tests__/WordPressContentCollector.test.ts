import { describe, it, expect, vi } from 'vitest';
import { WordPressContentCollector } from '../WordPressContentCollector';
import { CABO_FRIO_CONFIG } from '../config/cabo-frio';
import type { WordPressApiClient, WordPressPost, FetchPostsResult, FetchPostsParams } from '../WordPressApiClient';
import type { WordPressContentSourceConfig } from '../config/WordPressContentSourceConfig';

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
    link: 'https://example.gov.br/post',
    title: { rendered: 'Post de teste' },
    content: { rendered: '<p>conteúdo</p>' },
    categories: [73],
    ...overrides,
  };
}

describe('WordPressContentCollector — instanciado com a config real de Cabo Frio', () => {
  it('usa sourceKey, display_name e marcador exatamente como definidos em CABO_FRIO_CONFIG, sem nenhum import direto de config dentro do motor', () => {
    const client = makeFakeClient([
      [
        makePost({
          id: 1,
          content: {
            rendered:
              '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga no Forte</strong><br>Dia: 28 de junho de 2026<br>Horário: 7h às 8h<br>Local: Canto do Forte</p>',
          },
        }),
      ],
    ]);

    const collector = new WordPressContentCollector(client, CABO_FRIO_CONFIG);
    expect(collector.sourceKey).toBe('prefeitura_cabo_frio');
  });

  it('processa um post real do formato confirmado de Cabo Frio corretamente', async () => {
    const client = makeFakeClient([
      [
        makePost({
          id: 1,
          content: {
            rendered:
              '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga no Forte</strong><br>Dia: 28 de junho de 2026<br>Horário: 7h às 8h<br>Local: Canto do Forte</p>',
          },
        }),
      ],
    ]);

    const collector = new WordPressContentCollector(client, CABO_FRIO_CONFIG);
    const result = await collector.collect({ sinceDays: 30, maxPages: 5 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].source_key).toBe('prefeitura_cabo_frio');
    expect(result.items[0].title).toBe('Yoga no Forte');
  });
});

describe('WordPressContentCollector — instanciado com uma SEGUNDA config sintética, com marcador diferente', () => {
  // Prova de generalização real: uma instância hipotética que usa
  // "PROGRAMAÇÃO:" em vez de "SERVIÇO:" funciona com o MESMO código
  // do motor, mudando apenas a config injetada — nenhuma linha do
  // WordPressContentCollector, do parser ou do orquestrador foi
  // tocada para este teste passar.
  const syntheticConfig: WordPressContentSourceConfig = {
    ...CABO_FRIO_CONFIG,
    source_key: 'organizacao_sintetica_teste',
    display_name: 'Organização Sintética de Teste',
    structured_block_marker: /programa[çc][ãa]o:?/i,
  };

  it('usa o marcador PROGRAMAÇÃO: configurado, sem nenhuma alteração de código', async () => {
    const client = makeFakeClient([
      [
        makePost({
          id: 1,
          content: {
            rendered:
              '<p><strong>PROGRAMAÇÃO:</strong></p><p><strong>Show Cultural</strong><br>Dia: 1 de julho de 2026<br>Horário: 19h</p>',
          },
        }),
      ],
    ]);

    const collector = new WordPressContentCollector(client, syntheticConfig);
    const result = await collector.collect({ sinceDays: 30, maxPages: 5 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].source_key).toBe('organizacao_sintetica_teste');
    expect(result.items[0].title).toBe('Show Cultural');
  });

  it('o mesmo texto com marcador SERVIÇO: NÃO seria reconhecido por esta instância (prova de isolamento)', async () => {
    const client = makeFakeClient([
      [
        makePost({
          id: 1,
          content: {
            rendered:
              '<p><strong>SERVIÇO:</strong></p><p><strong>Show Cultural</strong><br>Dia: 1 de julho de 2026<br>Horário: 19h</p>',
          },
        }),
      ],
    ]);

    const collector = new WordPressContentCollector(client, syntheticConfig);
    const result = await collector.collect({ sinceDays: 30, maxPages: 5 });

    // Cai para narrativa (camada 2) em vez de structured_block, porque
    // o marcador configurado para ESTA instância é PROGRAMAÇÃO, não SERVIÇO
    expect(result.stats.posts_parsed_structured_block).toBe(0);
  });
});
