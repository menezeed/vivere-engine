import { describe, it, expect, vi } from 'vitest';
import { mapToRawActivityItems, type WordPressPostInput } from '../mapToRawActivityItems';
import * as narrativeModule from '../parsers/narrativeFallbackParser';

const SERVICO_MARKER = /servi[çc]o:?/i;
const PROGRAMACAO_MARKER = /programa[çc][ãa]o:?/i;

function makePost(overrides: Partial<WordPressPostInput>): WordPressPostInput {
  return {
    id: 1,
    title: 'Post de teste',
    contentHtml: '<p>conteúdo</p>',
    link: 'https://example.gov.br/post-teste',
    publishedAt: { year: 2026, month: 6, isoDate: '2026-06-01T10:00:00' },
    imageUrl: null,
    ...overrides,
  };
}

describe('mapToRawActivityItems — source_key é totalmente parametrizado, motor não conhece nenhuma instância', () => {
  const post = makePost({
    id: 110155,
    contentHtml:
      '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga no Forte</strong><br>Dia: 28 de junho de 2026<br>Horário: 7h</p>',
  });

  it('usa o source_key exatamente como fornecido pela config da instância', () => {
    const result = mapToRawActivityItems(post, {
      source_key: 'prefeitura_cabo_frio',
      structured_block_marker: SERVICO_MARKER,
    });
    expect(result.items[0].source_key).toBe('prefeitura_cabo_frio');
  });

  it('a mesma função, com source_key diferente, produz items com a nova identidade — sem nenhum resíduo da instância anterior', () => {
    const result = mapToRawActivityItems(post, {
      source_key: 'prefeitura_araruama',
      structured_block_marker: SERVICO_MARKER,
    });
    expect(result.items[0].source_key).toBe('prefeitura_araruama');
  });
});

describe('mapToRawActivityItems — marcador de bloco é totalmente parametrizado', () => {
  const postComServico = makePost({
    contentHtml:
      '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga no Forte</strong><br>Dia: 28 de junho de 2026<br>Horário: 7h</p>',
  });
  const postComProgramacao = makePost({
    contentHtml:
      '<p><strong>PROGRAMAÇÃO:</strong></p><p><strong>Yoga no Forte</strong><br>Dia: 28 de junho de 2026<br>Horário: 7h</p>',
  });

  it('usa camada 1 quando o marcador configurado casa com o texto', () => {
    const result = mapToRawActivityItems(postComServico, {
      source_key: 'fonte_teste',
      structured_block_marker: SERVICO_MARKER,
    });
    expect(result.extractionMethod).toBe('structured_block');
  });

  it('cai para camada 2 quando o marcador configurado NÃO casa, mesmo havendo bloco estruturado com outro marcador', () => {
    const result = mapToRawActivityItems(postComServico, {
      source_key: 'fonte_teste',
      structured_block_marker: PROGRAMACAO_MARKER, // configurado errado de propósito
    });
    expect(result.extractionMethod).not.toBe('structured_block');
  });

  it('usa camada 1 corretamente quando o marcador configurado é PROGRAMAÇÃO e o texto usa esse vocabulário', () => {
    const result = mapToRawActivityItems(postComProgramacao, {
      source_key: 'fonte_teste',
      structured_block_marker: PROGRAMACAO_MARKER,
    });
    expect(result.extractionMethod).toBe('structured_block');
  });
});

describe('mapToRawActivityItems — bloco estruturado com múltiplos eventos (caso real "Arraiás")', () => {
  const post = makePost({
    id: 110167,
    contentHtml:
      '<p><strong>SERVIÇO:</strong></p>' +
      '<p><strong>Arraiá da Praça da Bandeira</strong> – Passagem – 16h<br>sexta (26)</p>' +
      '<p><strong>Arraiá do Peró </strong>– Praça do Moinho – 17h<br>sexta (26)</p>',
  });

  it('gera 2 RawActivityItem distintos, ambos com o mesmo source_key da instância', () => {
    const result = mapToRawActivityItems(post, {
      source_key: 'prefeitura_cabo_frio',
      structured_block_marker: SERVICO_MARKER,
    });
    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => i.source_key === 'prefeitura_cabo_frio')).toBe(true);
  });
});

describe('mapToRawActivityItems — garantia de que a camada 2 nunca roda quando a camada 1 funciona', () => {
  it('parseNarrativeFallback NÃO é chamado quando o bloco estruturado já produziu sub-eventos', () => {
    const spy = vi.spyOn(narrativeModule, 'parseNarrativeFallback');
    const post = makePost({
      contentHtml:
        '<p><strong>SERVIÇO:</strong></p><p><strong>Evento Teste</strong><br>Dia: 1 de julho de 2026<br>Horário: 10h</p>',
    });

    mapToRawActivityItems(post, { source_key: 'fonte_teste', structured_block_marker: SERVICO_MARKER });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('mapToRawActivityItems — nenhum sinal extraível em nenhuma camada', () => {
  it('retorna zero items e motivo no_extractable_schedule_found', () => {
    const post = makePost({
      contentHtml: '<p>A Secretaria de Cultura anuncia novo edital de fomento para artistas locais.</p>',
    });
    const result = mapToRawActivityItems(post, { source_key: 'fonte_teste', structured_block_marker: SERVICO_MARKER });

    expect(result.items).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('no_extractable_schedule_found');
  });
});

describe('mapToRawActivityItems — contrato venue_mention (ajuste de Fase 3, ver estudo de modelo de entidades)', () => {
  it('camada 1 (bloco estruturado, rótulo Local: explícito) produz venue_mention com confidence_hint "explicit_name" (caso real "Yoga no Forte")', () => {
    const post = makePost({
      contentHtml:
        '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga no Forte</strong><br>Dia: 28 de junho de 2026<br>' +
        'Horário: 7h às 8h<br>Local: Canto do Forte, na Praia do Forte</p>',
    });

    const result = mapToRawActivityItems(post, { source_key: 'fonte_teste', structured_block_marker: SERVICO_MARKER });

    expect(result.items[0].venue_mention).toEqual({
      raw_text: 'Canto do Forte, na Praia do Forte',
      raw_address_text: null,
      confidence_hint: 'explicit_name',
    });
  });

  it('camada 2 (narrativa) produz venue_mention com confidence_hint "inferred_from_context"', () => {
    const post = makePost({
      contentHtml:
        '<p>Neste domingo (28) acontece uma apresentação especial no Centro Cultural. ' +
        'A partir das 19h, o público poderá acompanhar o show gratuitamente.</p>',
    });

    const result = mapToRawActivityItems(post, { source_key: 'fonte_teste', structured_block_marker: SERVICO_MARKER });

    expect(result.items[0].venue_mention).toEqual({
      raw_text: 'Centro Cultural',
      raw_address_text: null,
      confidence_hint: 'inferred_from_context',
    });
  });

  it('venue_mention é null (não um objeto com raw_text vazio) quando nenhum local é mencionado', () => {
    const post = makePost({
      contentHtml:
        '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga no Forte</strong><br>Dia: 28 de junho de 2026<br>Horário: 7h</p>',
    });

    const result = mapToRawActivityItems(post, { source_key: 'fonte_teste', structured_block_marker: SERVICO_MARKER });

    expect(result.items[0].venue_mention).toBeNull();
  });

  it('o contrato NUNCA expõe os seis campos antigos de venue completo (venue_name, venue_lat, etc.)', () => {
    const post = makePost({
      contentHtml:
        '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga no Forte</strong><br>Dia: 28 de junho de 2026<br>' +
        'Horário: 7h<br>Local: Canto do Forte</p>',
    });

    const result = mapToRawActivityItems(post, { source_key: 'fonte_teste', structured_block_marker: SERVICO_MARKER });
    const item = result.items[0] as unknown as Record<string, unknown>;

    // Nenhum dos seis campos antigos deveria existir no objeto — a fonte
    // de atividade nunca tem autoridade para afirmar venue completo
    expect(item).not.toHaveProperty('venue_name');
    expect(item).not.toHaveProperty('venue_address');
    expect(item).not.toHaveProperty('venue_lat');
    expect(item).not.toHaveProperty('venue_lng');
    expect(item).not.toHaveProperty('venue_phone');
    expect(item).not.toHaveProperty('venue_website');
  });

  it('venue_mention nunca contém raw_address_text preenchido (Collector atual não extrai endereço, só nome)', () => {
    const post = makePost({
      contentHtml:
        '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga no Forte</strong><br>Dia: 28 de junho de 2026<br>' +
        'Horário: 7h<br>Local: Canto do Forte</p>',
    });

    const result = mapToRawActivityItems(post, { source_key: 'fonte_teste', structured_block_marker: SERVICO_MARKER });

    expect(result.items[0].venue_mention?.raw_address_text).toBeNull();
  });
});
