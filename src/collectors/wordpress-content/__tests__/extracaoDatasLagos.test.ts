/**
 * Extracção de datas/horas nos padrões observados em Cabo Frio e Rio das
 * Ostras (dry-run de 11/2026). Fixtures SINTÉTICAS curtas (títulos e
 * textos inventados) que só reproduzem a ESTRUTURA dos posts reais.
 */
import { describe, it, expect } from 'vitest';
import { mapToRawActivityItems, type WordPressPostInput } from '../mapToRawActivityItems';
import { parseNarrativeFallback } from '../parsers/narrativeFallbackParser';
import { parseWordPressGmtDate } from '../../../lib/wordpressDates';
import { WordPressContentCollector } from '../WordPressContentCollector';
import type { WordPressApiClient, FetchPostsResult, WordPressPost } from '../WordPressApiClient';
import type { WordPressContentSourceConfig } from '../config/WordPressContentSourceConfig';

const CONFIG = { source_key: 'fonte_teste', structured_block_marker: /<strong>\s*servi[çc]o:?\s*<\/strong>/i };

function post(id: number, dateGmt: string, contentHtml: string): WordPressPostInput {
  const d = parseWordPressGmtDate(dateGmt);
  return {
    id,
    title: `Post ${id}`,
    contentHtml,
    link: `https://example.gov.br/${id}`,
    publishedAt: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, isoDate: dateGmt },
    imageUrl: null,
  };
}

const occ = (p: WordPressPostInput) => mapToRawActivityItems(p, CONFIG).items.map((i) => [i.title, i.occurrences]);

describe('bloco estruturado — rótulos e formatos novos', () => {
  it('rótulos em negrito com valor na mesma linha ("<strong>Atração:</strong> …") são campos do evento, não eventos novos', () => {
    const html =
      '<p><strong>SERVIÇO:</strong></p><p><strong>Recital de Piano</strong><br><strong>Atração:</strong> Duo Exemplo<br>' +
      '<strong>Data</strong>: 17 de Outubro de 2026<br><strong>Horário:</strong> 18h<br><strong>Entrada</strong>: gratuita<br>' +
      '<strong>Patrocínio:&nbsp;</strong> Instituto Exemplo</p>';
    expect(occ(post(1, '2026-10-15T11:30:00', html))).toEqual([
      ['Recital de Piano', [{ date: '2026-10-17', time: '18:00', end_date: null, end_time: null }]],
    ]);
  });

  it('"Dia: 21/10/2026" (numérica) e "Horário: a partir das 16h"', () => {
    const html = '<p><strong>SERVIÇO:</strong></p><p><strong>Cinema no Bairro</strong><br>Local: Ginásio<br>Dia: 21/10/2026<br>Horário: a partir das 16h</p>';
    expect(occ(post(2, '2026-10-14T18:00:00', html))).toEqual([
      ['Cinema no Bairro', [{ date: '2026-10-21', time: '16:00', end_date: null, end_time: null }]],
    ]);
  });

  it('"Data: Domingo, 8 de novembro" (sem ano) → ano da publicação, dia da semana confirmado', () => {
    const html = '<p><strong>SERVIÇO</strong></p><p><strong>ESPETÁCULO DE DANÇA</strong></p><p>Data: Domingo, 8 de novembro</p><p>Horário: 17h</p>';
    expect(occ(post(3, '2026-11-06T17:16:01', html))).toEqual([
      ['ESPETÁCULO DE DANÇA', [{ date: '2026-11-08', time: '17:00', end_date: null, end_time: null }]],
    ]);
  });

  it('"Data: Sábado, 8 de novembro" com dia da semana ERRADO → sem data (revisão)', () => {
    const html = '<p><strong>SERVIÇO</strong></p><p><strong>ESPETÁCULO</strong></p><p>Data: Sábado, 8 de novembro</p>';
    const r = mapToRawActivityItems(post(4, '2026-11-06T17:16:01', html), CONFIG);
    expect(r.items[0]!.occurrences).toEqual([]);
    expect(r.items[0]!.raw_payload['review_reasons']).toEqual(['structured_subevent_missing_date']);
  });

  it('"Dia e Horário: Sábado, 26 de Setembro – 18h"', () => {
    const html = '<p><strong>SERVIÇO</strong></p><p><strong>MOSTRA DE ARTE</strong></p><p>Dia e Horário: Sábado, 26 de Setembro – 18h</p>';
    expect(occ(post(5, '2026-09-24T17:58:08', html))).toEqual([
      ['MOSTRA DE ARTE', [{ date: '2026-09-26', time: '18:00', end_date: null, end_time: null }]],
    ]);
  });

  it('"<strong>Início:</strong> 5/11/2026" (curso) dá a data da 1.ª sessão; "<strong>Endereço</strong>:" não vira evento', () => {
    const html =
      '<p><strong>SERVIÇO</strong></p><p><strong>OFICINA DE CERÂMICA</strong></p><p><strong>Local:</strong> Casa da Cultura</p>' +
      '<p><strong>Endereço</strong>: Rua Exemplo, 70</p><p><strong>Início:</strong> 5/11/2026</p>' +
      '<p><strong>Horário:</strong> Quintas-feiras, das 13h30 às 16h30</p>';
    expect(occ(post(6, '2026-10-29T13:12:26', html))).toEqual([
      ['OFICINA DE CERÂMICA', [{ date: '2026-11-05', time: '13:30', end_date: null, end_time: '16:30' }]],
    ]);
  });

  it('linhas sem rótulo que começam por data: "Sábado, 10 de outubro, às 16h" e intervalo "De 10 a 12 de outubro, das 13h às 17h"', () => {
    const html =
      '<p><strong>SERVIÇO:</strong></p><p><strong>SHOW INSTRUMENTAL</strong></p><p>Show de exemplo<br>Sábado, 10 de outubro, às 16h<br>Praça Central</p>' +
      '<p><strong>EXPOSIÇÃO DE EXEMPLO</strong><br>De 10 a 12 de outubro, das 13h às 17h<br>Local: Casa de Cultura</p>';
    expect(occ(post(7, '2026-10-07T15:26:15', html))).toEqual([
      ['SHOW INSTRUMENTAL', [{ date: '2026-10-10', time: '16:00', end_date: null, end_time: null }]],
      ['EXPOSIÇÃO DE EXEMPLO', [{ date: '2026-10-10', time: '13:00', end_date: '2026-10-12', end_time: '17:00' }]],
    ]);
  });

  it('vários eventos com "Data: Sexta-feira, 30 de outubro" cada', () => {
    const html =
      '<p><strong>SERVIÇO:</strong></p><p>Local: Teatro</p>' +
      '<p><strong>Festival</strong></p><p>Data: Sexta-feira, 30 de outubro</p><p>Horário: 19h30</p>' +
      '<p><strong>Peça</strong></p><p>Data: Sábado, 31 de outubro</p><p>Horário: 19h (1ª sessão) e 20h30 (2ª sessão)</p>' +
      '<p><strong>Dança</strong></p><p>Data: Domingo, 1 de novembro</p>';
    expect(occ(post(8, '2026-10-29T20:52:27', html))).toEqual([
      ['Festival', [{ date: '2026-10-30', time: '19:30', end_date: null, end_time: null }]],
      // duas sessões → horário fica em aberto (nunca se escolhe uma)
      ['Peça', [{ date: '2026-10-31', time: null, end_date: null, end_time: null }]],
      ['Dança', [{ date: '2026-11-01', time: null, end_date: null, end_time: null }]],
    ]);
  });

  it('conservador: lista de dias, "Período: até…" e duas linhas "Data:" diferentes → sem data', () => {
    const lista = '<p><strong>Serviço:</strong></p><p><strong>Semana Temática<br></strong>Data: 10, 11 e 12 de outubro<br>Local: Shopping</p>';
    const periodo = '<p><strong>SERVIÇO</strong></p><p><strong>Exposição</strong></p><p>Local: Casa</p><p>Período: Em cartaz até o dia 28 de novembro</p>';
    const duas = '<p><strong>SERVIÇO</strong></p><p><strong>Oficina</strong></p><p>Data: 5 de novembro</p><p>Data: 12 de novembro</p>';
    for (const [id, html] of [[9, lista], [10, periodo], [11, duas]] as const) {
      expect(mapToRawActivityItems(post(id, '2026-10-09T18:56:14', html), CONFIG).items[0]!.occurrences).toEqual([]);
    }
  });

  it('"sexta (26)" no bloco: o mês vem da publicação COM validação do dia da semana', () => {
    // publicado a 29/10: "terça (03)" é 03/11 (terça), nunca 03/10 (sábado)
    const html = '<p><strong>SERVIÇO:</strong></p><p><strong>Arraiá</strong> – Praça – 16h<br>terça (03)</p>';
    expect(occ(post(12, '2026-10-29T18:32:24', html))).toEqual([
      ['Arraiá', [{ date: '2026-11-03', time: '16:00', end_date: null, end_time: null }]],
    ]);
  });
});

describe('narrativa — padrões novos e regras conservadoras', () => {
  const ref = (iso: string) => {
    const d = parseWordPressGmtDate(iso);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, referenceDate: d };
  };

  it('"No próximo domingo, dia 27, … às 16h" → data e hora', () => {
    const r = parseNarrativeFallback('<p>No próximo domingo, dia 27, a comunidade terá cinema ao ar livre. A sessão começa às 16h.</p>', ref('2026-09-22T17:16:50'));
    expect([r.status, r.date, r.time]).toEqual(['extracted', '2026-09-27', '16:00']);
  });

  it('"nesta quarta-feira, dia 11, a partir das 10h"', () => {
    const r = parseNarrativeFallback('<p>As inscrições começam nesta quarta-feira, dia 11, a partir das 10h, pela internet.</p>', ref('2026-11-10T19:46:52'));
    expect([r.status, r.date, r.time]).toEqual(['extracted', '2026-11-11', '10:00']);
  });

  it('relato do que já aconteceu ("na última quarta-feira, dia 16") NÃO vira data', () => {
    const r = parseNarrativeFallback('<p>O grupo visitou o museu na última sexta-feira, dia 16, numa viagem cultural.</p>', ref('2026-10-20T18:20:09'));
    expect(r.status).toBe('not_found');
  });

  it('notícia do próprio dia ("iniciou nesta terça-feira, dia 22, o pagamento") NÃO vira data', () => {
    const r = parseNarrativeFallback('<p>A Fundação iniciou nesta terça-feira, dia 22, o pagamento dos projetos.</p>', ref('2026-09-22T17:54:18'));
    expect(r.status).toBe('not_found');
  });

  it('prazos ("até o dia 8 de novembro", "até 29 de janeiro de 2027") NÃO são datas de ocorrência', () => {
    const r1 = parseNarrativeFallback('<p>As inscrições seguem abertas até o dia 8 de novembro, pelo site.</p>', ref('2026-10-27T16:52:47'));
    const r2 = parseNarrativeFallback('<p>O cadastro segue disponível até 29 de janeiro de 2027.</p>', ref('2026-10-01T14:11:41'));
    expect([r1.status, r2.status]).toEqual(['not_found', 'not_found']);
  });

  it('dia da semana incoerente com o calendário ("quarta-feira (20)" quando 20/10/2026 é terça) → ambíguo', () => {
    const r = parseNarrativeFallback('<p>O cinema chega ao bairro na próxima quarta-feira (20), às 16h.</p>', ref('2026-10-14T18:00:00'));
    expect(r.status).toBe('ambiguous');
    expect(r.ambiguityReason).toContain('weekday_mismatch');
  });

  it('várias datas futuras continuam ambíguas (nunca se escolhe uma)', () => {
    const r = parseNarrativeFallback('<p>A festa acontece nesta sexta (09) e no sábado (10), a partir das 19h.</p>', ref('2026-10-07T15:10:00'));
    expect(r.status).toBe('ambiguous');
    expect(r.candidateDates.map((c) => c.date)).toEqual(['2026-10-09', '2026-10-10']);
  });

  it('r0 #2: retrospectiva de dezembro ("foi realizado em 10 de janeiro, às 19h") NÃO vira evento futuro', () => {
    const r = parseNarrativeFallback('<p>O concerto foi realizado em 10 de janeiro, às 19h, no teatro.</p>', ref('2026-12-20T12:00:00'));
    expect(r.status).toBe('not_found');
    expect(r.date).toBeNull();
  });

  it('r0 #4: datas PASSADAS com ano explícito continuam candidatas em qualquer formato (numérica, intervalo)', () => {
    const numerica = parseNarrativeFallback('<p>A mostra aconteceu em 21/10/2026, no centro.</p>', ref('2026-11-05T12:00:00'));
    expect([numerica.status, numerica.date]).toEqual(['extracted', '2026-10-21']);
    const intervalo = parseNarrativeFallback('<p>A feira decorreu de 3 a 5 de outubro de 2026 na praça.</p>', ref('2026-11-05T12:00:00'));
    expect([intervalo.status, intervalo.date, intervalo.endDate]).toEqual(['extracted', '2026-10-03', '2026-10-05']);
  });

  it('"às19h30" (sem espaço) é lido como horário', () => {
    const r = parseNarrativeFallback('<p>A peça será no sábado, dia 14, às19h30, no teatro.</p>', ref('2026-11-12T11:53:00'));
    expect([r.status, r.date, r.time]).toEqual(['extracted', '2026-11-14', '19:30']);
  });
});

describe('WordPressContentCollector — errors[] só com posts descartados', () => {
  const sourceConfig: WordPressContentSourceConfig = {
    source_key: 'fonte_teste',
    display_name: 'Fonte de teste',
    product_key: 'vivere-60-mais',
    source_priority: 100,
    base_url: 'https://example.gov.br',
    category_id: 1,
    since_days: 100000,
    max_pages: 1,
    per_page: 20,
    delay_ms_between_pages: 0,
    structured_block_marker: /<strong>\s*servi[çc]o:?\s*<\/strong>/i,
  };
  const wpPost = (id: number, content: string): WordPressPost => ({
    id,
    date: '2026-11-06T14:00:00',
    date_gmt: '2026-11-06T17:00:00',
    link: `https://example.gov.br/${id}`,
    title: { rendered: `Post ${id}` },
    content: { rendered: content },
    categories: [1],
  });
  const client = (posts: WordPressPost[]) =>
    ({ fetchPosts: async (): Promise<FetchPostsResult> => ({ posts, totalPages: 1 }) }) as unknown as WordPressApiClient;

  it('item gerado sem data NÃO entra em errors[] (antes contava em "recolhidos" E em "descartes")', async () => {
    const posts = [
      wpPost(1, '<p><strong>SERVIÇO</strong></p><p><strong>Exposição A</strong></p><p>Período: em cartaz</p>'),
      wpPost(2, '<p><strong>SERVIÇO</strong></p><p><strong>Exposição B</strong></p><p>Período: em cartaz</p>'),
      wpPost(3, '<p>Notícia institucional sem nenhuma data.</p>'),
      wpPost(4, '<p>Show nesta sexta (13) e no sábado (14), às 20h.</p>'),
    ];
    const result = await new WordPressContentCollector(client(posts), sourceConfig).collect();
    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => i.occurrences.length === 0)).toBe(true);
    expect(result.errors.map((e) => e.message.split(':')[0])).toEqual(['no_extractable_schedule_found', 'narrative_ambiguous']);
  });
});
