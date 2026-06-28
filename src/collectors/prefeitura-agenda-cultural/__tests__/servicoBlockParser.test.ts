import { describe, it, expect } from 'vitest';
import { parseServicoBlock } from '../parsers/servicoBlockParser';

describe('parseServicoBlock — formato rotulado (caso real "Yoga no Forte")', () => {
  const html =
    '<p>Neste domingo (28) o Canto do Forte...</p>\n\n\n\n<p><strong>SERVIÇO:</strong></p>\n\n\n\n' +
    '<p><strong>Yoga no Forte – Edição de junho</strong><br>Dia: 28 de junho de 2026<br>' +
    'Horário: 7h às 8h<br>Local: Canto do Forte, na Praia do Forte<br>' +
    'Atividade gratuita e indicada para todas as idades</p>';

  it('encontra o bloco SERVIÇO', () => {
    expect(parseServicoBlock(html, { year: 2026, month: 6 }).found).toBe(true);
  });

  it('extrai exatamente 1 sub-evento, sem gerar um falso segundo evento a partir da linha final sem rótulo', () => {
    // Regressão: versão inicial do parser tratava "Atividade gratuita..."
    // como um segundo sub-evento por engano, pois vinha sem rótulo
    // depois de já termos visto "Local:". Delimitar por <strong> no
    // HTML em vez de heurística de linha resolveu isso.
    const result = parseServicoBlock(html, { year: 2026, month: 6 });
    expect(result.subEvents).toHaveLength(1);
  });

  it('extrai título, data, horário e venue corretamente', () => {
    const [event] = parseServicoBlock(html, { year: 2026, month: 6 }).subEvents;
    expect(event.title).toBe('Yoga no Forte – Edição de junho');
    expect(event.date).toBe('2026-06-28');
    expect(event.time).toBe('07:00');
    expect(event.endTime).toBe('08:00');
    expect(event.venueName).toBe('Canto do Forte, na Praia do Forte');
  });
});

describe('parseServicoBlock — formato compacto (caso real "Arraiás", sem rótulos)', () => {
  const html =
    '<p>Os bairros da Passagem e Peró...</p>\n\n\n\n<p><strong>SERVIÇO:</strong></p>\n\n\n\n' +
    '<p><strong>Arraiá da Praça da Bandeira</strong> – Passagem – 16h<br>sexta (26) e sábado (27)</p>\n\n\n\n' +
    '<p><strong>Arraiá do Peró </strong>– Praça do Moinho – 17h<br>sexta (26) e sábado (27)</p>';

  it('decompõe em 2 sub-eventos distintos a partir de 2 tags <strong>', () => {
    // Regressão: versão inicial nunca separava este formato em 2
    // eventos, porque a heurística original dependia da presença de
    // rótulos Dia:/Horário:/Local:, que este formato não usa.
    const result = parseServicoBlock(html, { year: 2026, month: 6 });
    expect(result.subEvents).toHaveLength(2);
  });

  it('extrai título, venue e hora do primeiro arraiá a partir do texto solto após o </strong>', () => {
    const [first] = parseServicoBlock(html, { year: 2026, month: 6 }).subEvents;
    expect(first.title).toBe('Arraiá da Praça da Bandeira');
    expect(first.venueName).toBe('Passagem');
    expect(first.time).toBe('16:00');
  });

  it('extrai título, venue e hora do segundo arraiá independentemente do primeiro', () => {
    const [, second] = parseServicoBlock(html, { year: 2026, month: 6 }).subEvents;
    expect(second.title).toBe('Arraiá do Peró');
    expect(second.venueName).toBe('Praça do Moinho');
    expect(second.time).toBe('17:00');
  });

  it('preenche a data a partir do dia entre parênteses combinado com mês/ano de publicação, nunca adivinhando o mês', () => {
    const [first] = parseServicoBlock(html, { year: 2026, month: 6 }).subEvents;
    expect(first.date).toBe('2026-06-26'); // dia 26 extraído de "sexta (26)", mês/ano vêm da referência explícita
  });
});

describe('parseServicoBlock — ausência do marcador', () => {
  it('retorna found=false quando não há "SERVIÇO:" no texto', () => {
    const html = '<p>Apenas uma notícia qualquer, sem programação estruturada.</p>';
    const result = parseServicoBlock(html, { year: 2026, month: 6 });
    expect(result.found).toBe(false);
    expect(result.subEvents).toHaveLength(0);
  });
});

describe('parseServicoBlock — robustez', () => {
  it('descarta sub-bloco sem título reconhecível em vez de inventar um', () => {
    const html = '<p><strong>SERVIÇO:</strong></p><p><strong></strong><br>Dia: 10 de julho de 2026</p>';
    const result = parseServicoBlock(html, { year: 2026, month: 7 });
    expect(result.subEvents.every((ev) => ev.title.length > 0)).toBe(true);
  });
});

describe('parseServicoBlock — regressão real: rótulos em negrito não geram sub-eventos falsos', () => {
  // Caso real do dry-run: um post real usava <strong> tanto no título
  // do evento quanto nos próprios rótulos (Local:, Horário:), o que
  // sem correção gerava sub-eventos falsos chamados literalmente
  // "Local:" e "Horário:", sem data nem sentido.
  it('funde rótulos Local:/Horário: em negrito com o sub-evento anterior, em vez de criar sub-eventos vazios', () => {
    const html =
      '<p><strong>SERVIÇO:</strong></p><p><strong>Qualificação para Editais Cultura Viva 2026</strong><br>' +
      '<strong>Local:</strong> Centro de Cabo Frio<br><strong>Horário:</strong> 14h</p>';

    const result = parseServicoBlock(html, { year: 2026, month: 6 });

    expect(result.subEvents).toHaveLength(1);
    expect(result.subEvents[0].title).toBe('Qualificação para Editais Cultura Viva 2026');
    expect(result.subEvents[0].venueName).toBe('Centro de Cabo Frio');
  });

  it('nunca gera um sub-evento cujo título é, ele próprio, apenas um rótulo conhecido', () => {
    const html = '<p><strong>SERVIÇO:</strong></p><p><strong>Local:</strong> Algum lugar</p>';
    const result = parseServicoBlock(html, { year: 2026, month: 6 });

    // Sem título de evento real antes do rótulo, não há onde fundir —
    // o sub-evento resultante (se algum) nunca deveria se chamar "Local:"
    expect(result.subEvents.every((ev) => ev.title.toLowerCase() !== 'local:')).toBe(true);
  });

  it('caso real completo: cabeçalho com Local/Dia/Horário em negrito extrai venue corretamente', () => {
    const html =
      '<p><strong>SERVIÇO:</strong></p><p><strong>Projeto "O Canto do Forte"</strong><br>' +
      '<strong>Local:</strong> Forte São Mateus<br><strong>Dia:</strong> 5, 6 e 7 de junho<br>' +
      '<strong>Horário:</strong> 16h</p>';

    const result = parseServicoBlock(html, { year: 2026, month: 6 });

    expect(result.subEvents).toHaveLength(1);
    expect(result.subEvents[0].venueName).toBe('Forte São Mateus');
  });
});

describe('parseServicoBlock — regressão real: descarte de rótulos informativos genéricos (estrutural, não por palavra)', () => {
  // Caso real residual do dry-run: "Mediação dos cursos:" sobrava como
  // sub-evento vazio mesmo após a correção dos rótulos de agenda
  // (Local:/Dia:/Horário:). Generalização pedida: detectar pelo PADRÃO
  // estrutural (curto, termina em ":", sem dado de agenda associado),
  // não por uma lista fechada de palavras específicas.

  it('descarta "Mediação dos cursos:" quando não há nenhum dado de agenda associado (caso real)', () => {
    const html =
      '<p><strong>SERVIÇO:</strong></p>' +
      '<p><strong>Qualificação para Editais Cultura Viva 2026</strong><br>' +
      '<strong>Local:</strong> Centro de Cabo Frio<br><strong>Horário:</strong> 14h</p>' +
      '<p><strong>Mediação dos cursos:</strong> equipe técnica</p>';

    const result = parseServicoBlock(html, { year: 2026, month: 6 });

    expect(result.subEvents).toHaveLength(1);
    expect(result.subEvents[0].title).toBe('Qualificação para Editais Cultura Viva 2026');
    expect(result.subEvents.some((ev) => ev.title.includes('Mediação'))).toBe(false);
  });

  it.each([
    ['Informações:'],
    ['Observações:'],
    ['Realização:'],
    ['Coordenação:'],
    ['Contato:'],
    ['Inscrições:'],
  ])('descarta o rótulo genérico "%s" quando isolado, sem dado de agenda', (label) => {
    const html =
      `<p><strong>SERVIÇO:</strong></p><p><strong>Show de Música no Centro Cultural</strong><br>` +
      `Dia: 10 de julho de 2026<br>Horário: 19h</p><p><strong>${label}</strong> mais detalhes aqui</p>`;

    const result = parseServicoBlock(html, { year: 2026, month: 7 });

    expect(result.subEvents).toHaveLength(1); // só o evento real, o rótulo genérico foi descartado
    expect(result.subEvents[0].title).toBe('Show de Música no Centro Cultural');
  });

  it('NÃO descarta um sub-evento com título curto terminado em ":" se ele carregar dado de agenda real', () => {
    // Garantia de que a regra é sobre AUSÊNCIA de dado de agenda, não
    // apenas sobre a forma sintática do título — um título atípico
    // que ainda assim carrega data/venue não deve ser descartado.
    const html = '<p><strong>SERVIÇO:</strong></p><p><strong>Contato:</strong><br>Dia: 5 de julho de 2026<br>Local: Praça Central</p>';

    const result = parseServicoBlock(html, { year: 2026, month: 7 });

    expect(result.subEvents).toHaveLength(1);
    expect(result.subEvents[0].venueName).toBe('Praça Central');
  });

  it('não confunde marcador temporal ("Dia 5:") com rótulo informativo genérico', () => {
    // isGenericInformationalLabel exclui explicitamente títulos com
    // números, para nunca competir com isOnlyTemporalGroupingMarker.
    const html = '<p><strong>SERVIÇO:</strong></p><p><strong>Dia 5:</strong> Abertura do festival</p>';
    const result = parseServicoBlock(html, { year: 2026, month: 7 });

    // título tem número, não é tratado como rótulo informativo genérico —
    // segue para os caminhos normais de extração (pode ou não ter sucesso,
    // mas não é descartado por esta regra especificamente)
    expect(result.subEvents.some((ev) => ev.title === 'Dia 5:')).toBe(true);
  });

  it('título de evento real longo (mais de 4 palavras) terminado em substantivo nunca é confundido com rótulo', () => {
    const html =
      '<p><strong>SERVIÇO:</strong></p><p><strong>Festival de Música Popular Brasileira na Praça</strong><br>' +
      'Dia: 1 de agosto de 2026<br>Horário: 18h</p>';

    const result = parseServicoBlock(html, { year: 2026, month: 8 });
    expect(result.subEvents).toHaveLength(1);
    expect(result.subEvents[0].title).toBe('Festival de Música Popular Brasileira na Praça');
  });
});

describe('parseServicoBlock — regressão real: detecção de marcador de agrupamento temporal (schedule_grouping_detected)', () => {
  // Caso real do dry-run: um post listava "Sexta (5) – Banda X",
  // "Sábado (6) – Banda Y" como sub-eventos — o parser capturava a
  // banda como se fosse o venue, o que é semanticamente errado.
  // Decisão do usuário: não reconstruir automaticamente, apenas
  // sinalizar para revisão de forma generalizada (não específica a
  // "Sexta"/"Sábado", mas a qualquer marcador puramente temporal).
  const html =
    '<p><strong>SERVIÇO:</strong></p>' +
    '<p><strong>Sexta (5)</strong> – Luma e Banda Boteco Chic</p>' +
    '<p><strong>Sábado (6)</strong> – DJ Sid e Bossa Lounge</p>' +
    '<p><strong>Domingo (7)</strong> – Sunset Eletro Lounge</p>';

  it('marca cada sub-evento com reviewReason schedule_grouping_detected quando o título é só dia da semana + número', () => {
    const result = parseServicoBlock(html, { year: 2026, month: 6 });
    expect(result.subEvents).toHaveLength(3);
    expect(result.subEvents.every((ev) => ev.reviewReason === 'schedule_grouping_detected')).toBe(true);
  });

  it('preserva data, venue (ainda que semanticamente incorreto) e rawText, sem descartar o sub-evento', () => {
    const result = parseServicoBlock(html, { year: 2026, month: 6 });
    const [first] = result.subEvents;

    expect(first.date).toBe('2026-06-05');
    expect(first.venueName).toBe('Luma e Banda Boteco Chic'); // capturado, mesmo sabendo que semanticamente é a atração, não o local
    expect(first.rawBlockText).toContain('Sexta (5)');
  });

  it('NÃO marca reviewReason quando o título tem um nome de evento real, mesmo mencionando um dia', () => {
    const normalHtml =
      '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga no Forte – Edição de junho</strong><br>' +
      'Dia: 28 de junho de 2026<br>Horário: 7h às 8h</p>';

    const result = parseServicoBlock(normalHtml, { year: 2026, month: 6 });
    expect(result.subEvents[0].reviewReason).toBeNull();
  });

  it('também detecta data numérica solta e nome de mês isolado como marcadores de agrupamento', () => {
    const dateOnlyHtml = '<p><strong>SERVIÇO:</strong></p><p><strong>05/06</strong> – Abertura</p>';
    const monthOnlyHtml = '<p><strong>SERVIÇO:</strong></p><p><strong>Junho</strong> – Programação do mês</p>';

    expect(parseServicoBlock(dateOnlyHtml, { year: 2026, month: 6 }).subEvents[0].reviewReason).toBe(
      'schedule_grouping_detected',
    );
    expect(parseServicoBlock(monthOnlyHtml, { year: 2026, month: 6 }).subEvents[0].reviewReason).toBe(
      'schedule_grouping_detected',
    );
  });
});
