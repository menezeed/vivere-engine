/**
 * Risco 3 (relatório L4) — `date_gmt` da WordPress REST API vem SEM
 * designador de fuso ("2026-06-30T23:30:00"), mas é UTC por definição.
 * `new Date(str)` interpreta uma data-hora ISO sem fuso como HORA LOCAL
 * da máquina, o que desloca o ano/mês de referência (usado para datas
 * como "sexta (26)") e a janela since_days perto da viragem do mês.
 *
 * Estes testes fixam process.env.TZ num fuso ≠ UTC para que o erro se
 * manifeste em qualquer máquina (inclusive CI em UTC).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseWordPressGmtDate } from '../../../lib/wordpressDates';
import { WordPressContentCollector } from '../WordPressContentCollector';
import { fetchPostsSince, type WordPressApiClient, type WordPressPost, type FetchPostsResult } from '../WordPressApiClient';
import { PrefeituraAgendaCulturalCollector } from '../../prefeitura-agenda-cultural/PrefeituraAgendaCulturalCollector';
import {
  fetchPostsSince as fetchPostsSinceLegacy,
  type WordPressApiClient as LegacyClient,
} from '../../prefeitura-agenda-cultural/WordPressApiClient';
import type { WordPressContentSourceConfig } from '../config/WordPressContentSourceConfig';

const ORIGINAL_TZ = process.env.TZ;

function setTz(tz: string): void {
  process.env.TZ = tz;
}

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function makePost(id: number, dateGmt: string, contentHtml: string): WordPressPost {
  return {
    id,
    date: dateGmt,
    date_gmt: dateGmt,
    link: `https://example.gov.br/post-${id}`,
    title: { rendered: `Post ${id}` },
    content: { rendered: contentHtml },
    categories: [1],
  };
}

function fakeClient(posts: WordPressPost[]): WordPressApiClient & LegacyClient {
  return {
    fetchPosts: vi.fn(async (): Promise<FetchPostsResult> => ({ posts, totalPages: 1 })),
  } as unknown as WordPressApiClient & LegacyClient;
}

const CONFIG: WordPressContentSourceConfig = {
  source_key: 'fonte_teste_utc',
  display_name: 'Fonte de teste (UTC)',
  product_key: 'vivere-60-mais',
  source_priority: 100,
  base_url: 'https://example.gov.br',
  category_id: 1,
  since_days: 30,
  max_pages: 1,
  per_page: 20,
  delay_ms_between_pages: 0,
  structured_block_marker: /<strong>\s*servi[çc]o:?\s*<\/strong>/i,
};

/** Bloco estruturado cujo dia "(26)" é combinado com o ano/mês de publicação. */
const ARRAIA = '<p><strong>SERVIÇO:</strong></p><p><strong>Arraiá de Teste</strong> – Praça Central – 16h<br>sexta (26)</p>';

// Janela muito larga: o filtro since_days não interfere nos testes de mês.
const WIDE = { sinceDays: 100000 };

describe('date_gmt é UTC — mês/ano de referência (WordPressContentCollector)', () => {
  it('fuso a oeste (UTC-3): 30/06 23:30 UTC continua a ser JUNHO', async () => {
    setTz('America/Sao_Paulo');
    const collector = new WordPressContentCollector(fakeClient([makePost(1, '2026-06-30T23:30:00', ARRAIA)]), CONFIG);
    const result = await collector.collect(WIDE);
    expect(result.items[0]!.occurrences[0]!.date).toBe('2026-06-26');
  });

  it('fuso a leste (UTC+9): 01/07 00:30 UTC continua a ser JULHO', async () => {
    setTz('Asia/Tokyo');
    const collector = new WordPressContentCollector(fakeClient([makePost(2, '2026-07-01T00:30:00', ARRAIA)]), CONFIG);
    const result = await collector.collect(WIDE);
    expect(result.items[0]!.occurrences[0]!.date).toBe('2026-07-26');
  });

  it('viragem do ano (UTC-3): 31/12 23:30 UTC continua a ser 2026', async () => {
    setTz('America/Sao_Paulo');
    const collector = new WordPressContentCollector(fakeClient([makePost(3, '2026-12-31T23:30:00', ARRAIA)]), CONFIG);
    const result = await collector.collect(WIDE);
    expect(result.items[0]!.occurrences[0]!.date).toBe('2026-12-26');
  });

});

describe('date_gmt é UTC — mês de referência (PrefeituraAgendaCulturalCollector)', () => {
  it('fuso a oeste (UTC-3): 30/06 23:30 UTC continua a ser JUNHO', async () => {
    setTz('America/Sao_Paulo');
    const collector = new PrefeituraAgendaCulturalCollector(fakeClient([makePost(5, '2026-06-30T23:30:00', ARRAIA)]));
    const result = await collector.collect(WIDE);
    expect(result.items[0]!.occurrences[0]!.date).toBe('2026-06-26');
  });
});

describe('date_gmt é UTC — janela since (fetchPostsSince)', () => {
  const sinceDate = new Date('2026-07-01T00:00:00Z');
  const opts = { categoryId: 1, sinceDate, perPage: 20, maxPages: 1, delayMsBetweenPages: 0 };
  const posts = [makePost(10, '2026-07-01T00:30:00', ''), makePost(11, '2026-06-30T23:30:00', '')];

  async function idsWithin(gen: AsyncGenerator<WordPressPost[]>): Promise<number[]> {
    const ids: number[] = [];
    for await (const page of gen) ids.push(...page.map((p) => p.id));
    return ids;
  }

  it.each(['America/Sao_Paulo', 'Asia/Tokyo', 'UTC'])('wordpress-content (TZ=%s): só o post de 01/07 00:30 UTC entra', async (tz) => {
    setTz(tz);
    expect(await idsWithin(fetchPostsSince(fakeClient(posts), opts))).toEqual([10]);
  });

  it.each(['America/Sao_Paulo', 'Asia/Tokyo'])('prefeitura-agenda-cultural (TZ=%s): só o post de 01/07 00:30 UTC entra', async (tz) => {
    setTz(tz);
    expect(await idsWithin(fetchPostsSinceLegacy(fakeClient(posts), opts))).toEqual([10]);
  });
});

describe('parseWordPressGmtDate', () => {
  it('data-hora sem fuso é UTC, independentemente do fuso da máquina', () => {
    for (const tz of ['America/Sao_Paulo', 'Asia/Tokyo', 'UTC']) {
      setTz(tz);
      expect(parseWordPressGmtDate('2026-06-30T23:30:00').toISOString()).toBe('2026-06-30T23:30:00.000Z');
    }
  });

  it('respeita um fuso explícito ("Z" ou "±hh:mm") sem o alterar', () => {
    setTz('Asia/Tokyo');
    expect(parseWordPressGmtDate('2026-06-30T23:30:00Z').toISOString()).toBe('2026-06-30T23:30:00.000Z');
    expect(parseWordPressGmtDate('2026-06-30T20:30:00-03:00').toISOString()).toBe('2026-06-30T23:30:00.000Z');
  });

  it('aceita frações de segundo e espaços à volta', () => {
    expect(parseWordPressGmtDate(' 2026-06-30T23:30:00.250 ').toISOString()).toBe('2026-06-30T23:30:00.250Z');
  });

  it('string inválida → Date inválida, como new Date() (nada é inventado)', () => {
    expect(Number.isNaN(parseWordPressGmtDate('nao-e-data').getTime())).toBe(true);
    expect(Number.isNaN(parseWordPressGmtDate('').getTime())).toBe(true);
  });
});
