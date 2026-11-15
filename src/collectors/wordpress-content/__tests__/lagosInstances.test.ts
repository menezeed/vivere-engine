/**
 * Búzios e Rio das Ostras — configs WordPress (L1, 14/11/2026).
 *
 * As fixtures em fixtures/*.posts.json são SINTÉTICAS: reproduzem a
 * estrutura HTML real observada nos endpoints públicos
 * (/wp-json/wp/v2/posts) de cada prefeitura, com textos reduzidos e
 * sem nomes de pessoas, telefones ou emails. Nenhum pedido de rede é
 * feito por estes testes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapToRawActivityItems, type WordPressPostInput } from '../mapToRawActivityItems';
import type { WordPressPost } from '../WordPressApiClient';
import { BUZIOS_CONFIG } from '../config/buzios';
import { RIO_DAS_OSTRAS_CONFIG } from '../config/rio-das-ostras';
import { AVAILABLE_INSTANCES, getWordPressSourceConfigBySourceKey } from '../config/registry';

function loadFixture(name: string): WordPressPost[] {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.posts.json`, import.meta.url), 'utf8'),
  ) as WordPressPost[];
}

/** Mesma conversão que WordPressContentCollector faz (wordPressPostToInput). */
function toInput(post: WordPressPost): WordPressPostInput {
  const published = new Date(post.date_gmt);
  return {
    id: post.id,
    title: post.title.rendered,
    contentHtml: post.content.rendered,
    link: post.link,
    publishedAt: {
      year: published.getUTCFullYear(),
      month: published.getUTCMonth() + 1,
      isoDate: post.date_gmt,
    },
    imageUrl: null,
  };
}

describe('registry — novas instâncias da Região dos Lagos', () => {
  it.each([
    ['buzios', 'prefeitura_buzios', 'Armação dos Búzios', 1415, 'https://buzios.rj.gov.br'],
    ['rio-das-ostras', 'prefeitura_rio_das_ostras', 'Rio das Ostras', 17, 'https://www.riodasostras.rj.gov.br'],
  ])('%s está registada com source_key, cidade, categoria e domínio confirmados', (instanceKey, sourceKey, city, categoryId, baseUrl) => {
    const config = AVAILABLE_INSTANCES[instanceKey];
    expect(config).toBeDefined();
    expect(config!.source_key).toBe(sourceKey);
    expect(config!.category_id).toBe(categoryId);
    expect(config!.base_url).toBe(baseUrl);
    expect(config!.region_metadata).toEqual({ city, state: 'RJ' });
    expect(config!.product_key).toBe('vivere-60-mais');
    expect(getWordPressSourceConfigBySourceKey(sourceKey)).toBe(config);
  });
});

describe('Rio das Ostras — bloco "<strong>SERVIÇO</strong>" (sem dois-pontos)', () => {
  const [espetaculo, exposicao, inscricoes] = loadFixture('rio-das-ostras');

  it('o marcador configurado reconhece o bloco real e extrai título e local', () => {
    const result = mapToRawActivityItems(toInput(espetaculo!), RIO_DAS_OSTRAS_CONFIG);
    expect(result.extractionMethod).toBe('structured_block');
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.source_key).toBe('prefeitura_rio_das_ostras');
    expect(item.source_item_id).toBe('900001_0');
    expect(item.title).toBe('ESPETÁCULO DE DANÇA DE FIM DE ANO');
    expect(item.venue_mention?.raw_text).toBe('Teatro Municipal');
  });

  it('"Data: Domingo, 8 de novembro" (sem ano) NÃO gera data — o motor não infere o ano; o item vai para revisão', () => {
    const result = mapToRawActivityItems(toInput(espetaculo!), RIO_DAS_OSTRAS_CONFIG);
    expect(result.items[0]!.occurrences).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual(['structured_subevent_missing_date']);
  });

  it('exposição com "Período: Em cartaz até…" também fica sem data e é sinalizada', () => {
    const result = mapToRawActivityItems(toInput(exposicao!), RIO_DAS_OSTRAS_CONFIG);
    expect(result.extractionMethod).toBe('structured_block');
    expect(result.items[0]!.venue_mention?.raw_text).toBe('Casa de Cultura');
    expect(result.skipped.map((s) => s.reason)).toEqual(['structured_subevent_missing_date']);
  });

  it('notícia de inscrições sem programação não gera item', () => {
    const result = mapToRawActivityItems(toInput(inscricoes!), RIO_DAS_OSTRAS_CONFIG);
    expect(result.items).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual(['no_extractable_schedule_found']);
  });
});

describe('Búzios — conteúdo narrativo (blocos Gutenberg, sem "Serviço")', () => {
  const [espetaculo, edital] = loadFixture('buzios');

  it('"nesta quarta-feira (21), às 9h" vira uma ocorrência pela camada narrativa', () => {
    const result = mapToRawActivityItems(toInput(espetaculo!), BUZIOS_CONFIG);
    expect(result.extractionMethod).toBe('narrative_fallback');
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.source_key).toBe('prefeitura_buzios');
    expect(item.source_item_id).toBe('900101_0');
    expect(item.occurrences).toEqual([
      { date: '2026-10-21', time: '09:00', end_date: null, end_time: null },
    ]);
  });

  it('notícia de edital (sem data de evento) não gera item', () => {
    const result = mapToRawActivityItems(toInput(edital!), BUZIOS_CONFIG);
    expect(result.items).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual(['no_extractable_schedule_found']);
  });
});
