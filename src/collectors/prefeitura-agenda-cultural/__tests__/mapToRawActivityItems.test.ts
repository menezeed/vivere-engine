import { describe, it, expect, vi } from 'vitest';
import { mapToRawActivityItems, type WordPressPostInput } from '../mapToRawActivityItems';
import * as narrativeModule from '../parsers/narrativeFallbackParser';

function makePost(overrides: Partial<WordPressPostInput>): WordPressPostInput {
  return {
    id: 1,
    title: 'Post de teste',
    contentHtml: '<p>conteúdo</p>',
    link: 'https://noticias.cabofrio.rj.gov.br/post-teste',
    publishedAt: { year: 2026, month: 6, isoDate: '2026-06-01T10:00:00' },
    imageUrl: null,
    ...overrides,
  };
}

describe('mapToRawActivityItems — bloco SERVIÇO simples (caso real "Yoga no Forte")', () => {
  const post = makePost({
    id: 110155,
    title: 'Canto do Forte recebe o projeto Yoga no Forte neste domingo (28)',
    contentHtml:
      '<p>Neste domingo (28) o Canto do Forte...</p><p><strong>SERVIÇO:</strong></p>' +
      '<p><strong>Yoga no Forte – Edição de junho</strong><br>Dia: 28 de junho de 2026<br>' +
      'Horário: 7h às 8h<br>Local: Canto do Forte, na Praia do Forte</p>',
    publishedAt: { year: 2026, month: 6, isoDate: '2026-06-24T14:06:29' },
  });

  it('gera exatamente 1 RawActivityItem', () => {
    const result = mapToRawActivityItems(post);
    expect(result.items).toHaveLength(1);
    expect(result.extractionMethod).toBe('servico_block');
  });

  it('preenche occurrences, venue e título corretamente a partir do bloco SERVIÇO', () => {
    const [item] = mapToRawActivityItems(post).items;
    expect(item.title).toBe('Yoga no Forte – Edição de junho');
    expect(item.occurrences).toEqual([{ date: '2026-06-28', time: '07:00', end_date: null, end_time: '08:00' }]);
    expect(item.venue_mention).toEqual({
      raw_text: 'Canto do Forte, na Praia do Forte',
      raw_address_text: null,
      confidence_hint: 'explicit_name',
    });
  });

  it('source_item_id combina post.id com índice de sub-evento', () => {
    const [item] = mapToRawActivityItems(post).items;
    expect(item.source_item_id).toBe('110155_0');
  });

  it('preserva confidence, reviewReasons e rawText em raw_payload', () => {
    const [item] = mapToRawActivityItems(post).items;
    expect(item.raw_payload.extraction_confidence).toBe(0.9);
    expect(item.raw_payload.review_reasons).toEqual([]);
    expect(item.raw_payload.raw_text).toContain('Yoga no Forte');
  });

  it('não gera nenhum item em skipped quando a extração é completa', () => {
    expect(mapToRawActivityItems(post).skipped).toHaveLength(0);
  });
});

describe('mapToRawActivityItems — bloco SERVIÇO com múltiplos eventos (caso real "Arraiás")', () => {
  const post = makePost({
    id: 110167,
    title: 'Arraiás da Praça da Bandeira e do Peró celebram as tradições',
    contentHtml:
      '<p>Os bairros...</p><p><strong>SERVIÇO:</strong></p>' +
      '<p><strong>Arraiá da Praça da Bandeira</strong> – Passagem – 16h<br>sexta (26) e sábado (27)</p>' +
      '<p><strong>Arraiá do Peró </strong>– Praça do Moinho – 17h<br>sexta (26) e sábado (27)</p>',
    publishedAt: { year: 2026, month: 6, isoDate: '2026-06-25T11:17:54' },
  });

  it('gera 2 RawActivityItem distintos a partir de 1 único post', () => {
    const result = mapToRawActivityItems(post);
    expect(result.items).toHaveLength(2);
  });

  it('cada item tem source_item_id único, indexado por sub-evento', () => {
    const result = mapToRawActivityItems(post);
    expect(result.items.map((i) => i.source_item_id)).toEqual(['110167_0', '110167_1']);
  });

  it('cada item preserva seu próprio título, venue e horário, sem misturar entre sub-eventos', () => {
    const [first, second] = mapToRawActivityItems(post).items;
    expect(first.title).toBe('Arraiá da Praça da Bandeira');
    expect(first.venue_mention).toEqual({
      raw_text: 'Passagem',
      raw_address_text: null,
      confidence_hint: 'explicit_name',
    });
    expect(first.occurrences[0].time).toBe('16:00');

    expect(second.title).toBe('Arraiá do Peró');
    expect(second.venue_mention).toEqual({
      raw_text: 'Praça do Moinho',
      raw_address_text: null,
      confidence_hint: 'explicit_name',
    });
    expect(second.occurrences[0].time).toBe('17:00');
  });
});

describe('mapToRawActivityItems — narrativa sem bloco SERVIÇO (caminho de sucesso)', () => {
  const post = makePost({
    id: 200,
    title: 'Apresentação especial no Centro Cultural',
    contentHtml:
      '<p>Neste domingo (28) acontece uma apresentação especial no Centro Cultural. ' +
      'A partir das 19h, o público poderá acompanhar o show gratuitamente.</p>',
    publishedAt: { year: 2026, month: 6, isoDate: '2026-06-20T10:00:00' },
  });

  it('usa o parser narrativo quando não há bloco SERVIÇO', () => {
    const result = mapToRawActivityItems(post);
    expect(result.extractionMethod).toBe('narrative_fallback');
    expect(result.items).toHaveLength(1);
  });

  it('usa o título do POST inteiro, nunca decompõe em sub-títulos (diferente da camada 1)', () => {
    const [item] = mapToRawActivityItems(post).items;
    expect(item.title).toBe('Apresentação especial no Centro Cultural');
  });

  it('confidence do item é a confidence mais baixa da camada 2, nunca a da camada 1', () => {
    const [item] = mapToRawActivityItems(post).items;
    expect(item.raw_payload.extraction_confidence).toBeLessThan(0.7);
    expect(item.raw_payload.extraction_method).toBe('narrative_fallback');
  });
});

describe('mapToRawActivityItems — narrativa ambígua (caso real "Forte São Mateus")', () => {
  const post = makePost({
    id: 109933,
    title: 'Forte São Mateus recebe mais uma edição de O Canto do Forte',
    contentHtml:
      '<p>Nesta sexta-feira (19) e no sábado (20), o Forte São Mateus recebe mais uma edição ' +
      'do evento musical. A partir das 16h, moradores e visitantes poderão apreciar o pôr do sol.</p>',
    publishedAt: { year: 2026, month: 6, isoDate: '2026-06-19T10:30:25' },
  });

  it('não gera nenhum RawActivityItem quando a narrativa é ambígua', () => {
    const result = mapToRawActivityItems(post);
    expect(result.items).toHaveLength(0);
  });

  it('registra o motivo da ambiguidade em skipped, preservando contexto para auditoria', () => {
    const result = mapToRawActivityItems(post);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('narrative_ambiguous');
    expect(result.skipped[0].context).toContain('múltiplas datas candidatas');
  });

  it('nunca inventa uma data ao "escolher" uma das datas candidatas', () => {
    const result = mapToRawActivityItems(post);
    expect(result.items).toHaveLength(0); // confirmação dupla: nenhum item parcial criado com palpite de data
  });
});

describe('mapToRawActivityItems — garantia de que a camada 2 nunca roda quando a camada 1 funciona', () => {
  it('parseNarrativeFallback NÃO é chamado quando o bloco SERVIÇO já produziu sub-eventos', () => {
    const spy = vi.spyOn(narrativeModule, 'parseNarrativeFallback');

    const post = makePost({
      id: 110155,
      contentHtml:
        '<p>texto</p><p><strong>SERVIÇO:</strong></p>' +
        '<p><strong>Evento Teste</strong><br>Dia: 1 de julho de 2026<br>Horário: 10h<br>Local: Praça Central</p>',
    });

    mapToRawActivityItems(post);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('parseNarrativeFallback É chamado quando o bloco SERVIÇO não está presente', () => {
    const spy = vi.spyOn(narrativeModule, 'parseNarrativeFallback');

    const post = makePost({
      contentHtml: '<p>Neste domingo (5), acontece um evento qualquer às 10h.</p>',
    });

    mapToRawActivityItems(post);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('resultado final nunca mistura itens da camada 1 com itens da camada 2 no mesmo post', () => {
    const post = makePost({
      id: 300,
      contentHtml:
        '<p><strong>SERVIÇO:</strong></p><p><strong>Evento A</strong><br>Dia: 1 de julho de 2026<br>Horário: 10h<br>Local: Praça</p>',
    });

    const result = mapToRawActivityItems(post);
    const methods = new Set(result.items.map((i) => i.raw_payload.extraction_method));
    expect(methods.size).toBe(1); // todos os items do mesmo post vêm do MESMO método de extração
    expect(methods.has('servico_block')).toBe(true);
  });
});

describe('mapToRawActivityItems — nenhum sinal extraível em nenhuma camada', () => {
  it('retorna zero items e motivo no_extractable_schedule_found', () => {
    const post = makePost({
      contentHtml: '<p>A Secretaria de Cultura anuncia novo edital de fomento para artistas locais.</p>',
    });

    const result = mapToRawActivityItems(post);
    expect(result.items).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('no_extractable_schedule_found');
    expect(result.extractionMethod).toBe('none');
  });
});
