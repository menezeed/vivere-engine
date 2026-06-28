import { describe, it, expect } from 'vitest';
import { parseStructuredBlock } from '../parsers/structuredBlockParser';

const SERVICO_MARKER = /servi[çc]o:?/i;

describe('parseStructuredBlock — formato rotulado (caso real "Yoga no Forte"), com marcador SERVIÇO configurado', () => {
  const html =
    '<p><strong>SERVIÇO:</strong></p>' +
    '<p><strong>Yoga no Forte – Edição de junho</strong><br>Dia: 28 de junho de 2026<br>' +
    'Horário: 7h às 8h<br>Local: Canto do Forte, na Praia do Forte</p>';

  it('encontra o bloco quando o marcador configurado casa', () => {
    expect(parseStructuredBlock(html, { year: 2026, month: 6 }, SERVICO_MARKER).found).toBe(true);
  });

  it('extrai título, data, horário e venue corretamente', () => {
    const [event] = parseStructuredBlock(html, { year: 2026, month: 6 }, SERVICO_MARKER).subEvents;
    expect(event.title).toBe('Yoga no Forte – Edição de junho');
    expect(event.date).toBe('2026-06-28');
    expect(event.time).toBe('07:00');
    expect(event.venueName).toBe('Canto do Forte, na Praia do Forte');
  });
});

describe('parseStructuredBlock — marcador configurável: mesma fonte, vocabulário diferente', () => {
  const htmlComServico =
    '<p><strong>SERVIÇO:</strong></p><p><strong>Show no Centro Cultural</strong><br>Dia: 1 de julho de 2026<br>Horário: 19h</p>';
  const htmlComProgramacao =
    '<p><strong>PROGRAMAÇÃO:</strong></p><p><strong>Show no Centro Cultural</strong><br>Dia: 1 de julho de 2026<br>Horário: 19h</p>';
  const htmlComAgenda =
    '<p><strong>AGENDA:</strong></p><p><strong>Show no Centro Cultural</strong><br>Dia: 1 de julho de 2026<br>Horário: 19h</p>';

  it('marcador SERVIÇO: não encontra bloco se a config usar outro marcador', () => {
    const result = parseStructuredBlock(htmlComProgramacao, { year: 2026, month: 7 }, SERVICO_MARKER);
    expect(result.found).toBe(false);
  });

  it('marcador PROGRAMAÇÃO: funciona quando configurado para essa instância', () => {
    const PROGRAMACAO_MARKER = /programa[çc][ãa]o:?/i;
    const result = parseStructuredBlock(htmlComProgramacao, { year: 2026, month: 7 }, PROGRAMACAO_MARKER);
    expect(result.found).toBe(true);
    expect(result.subEvents[0].title).toBe('Show no Centro Cultural');
  });

  it('marcador AGENDA: funciona quando configurado para essa instância', () => {
    const AGENDA_MARKER = /agenda:?/i;
    const result = parseStructuredBlock(htmlComAgenda, { year: 2026, month: 7 }, AGENDA_MARKER);
    expect(result.found).toBe(true);
  });

  it('o mesmo HTML com SERVIÇO: funciona com o marcador correto', () => {
    const result = parseStructuredBlock(htmlComServico, { year: 2026, month: 7 }, SERVICO_MARKER);
    expect(result.found).toBe(true);
  });
});

describe('parseStructuredBlock — formato compacto (caso real "Arraiás", sem rótulos)', () => {
  const html =
    '<p><strong>SERVIÇO:</strong></p>' +
    '<p><strong>Arraiá da Praça da Bandeira</strong> – Passagem – 16h<br>sexta (26) e sábado (27)</p>' +
    '<p><strong>Arraiá do Peró </strong>– Praça do Moinho – 17h<br>sexta (26) e sábado (27)</p>';

  it('decompõe em 2 sub-eventos distintos a partir de 2 tags <strong>', () => {
    const result = parseStructuredBlock(html, { year: 2026, month: 6 }, SERVICO_MARKER);
    expect(result.subEvents).toHaveLength(2);
  });

  it('extrai título, venue e hora do primeiro e segundo sub-evento corretamente', () => {
    const [first, second] = parseStructuredBlock(html, { year: 2026, month: 6 }, SERVICO_MARKER).subEvents;
    expect(first.title).toBe('Arraiá da Praça da Bandeira');
    expect(first.venueName).toBe('Passagem');
    expect(first.time).toBe('16:00');
    expect(second.title).toBe('Arraiá do Peró');
    expect(second.venueName).toBe('Praça do Moinho');
    expect(second.time).toBe('17:00');
  });
});

describe('parseStructuredBlock — ausência do marcador', () => {
  it('retorna found=false quando o marcador configurado não casa com nada no texto', () => {
    const html = '<p>Apenas uma notícia qualquer, sem programação estruturada.</p>';
    const result = parseStructuredBlock(html, { year: 2026, month: 6 }, SERVICO_MARKER);
    expect(result.found).toBe(false);
    expect(result.subEvents).toHaveLength(0);
  });
});

describe('parseStructuredBlock — regressão real: rótulos em negrito não geram sub-eventos falsos', () => {
  it('funde rótulos Local:/Horário: em negrito com o sub-evento anterior, em vez de criar sub-eventos vazios', () => {
    const html =
      '<p><strong>SERVIÇO:</strong></p><p><strong>Qualificação para Editais Cultura Viva 2026</strong><br>' +
      '<strong>Local:</strong> Centro de Cabo Frio<br><strong>Horário:</strong> 14h</p>';

    const result = parseStructuredBlock(html, { year: 2026, month: 6 }, SERVICO_MARKER);

    expect(result.subEvents).toHaveLength(1);
    expect(result.subEvents[0].title).toBe('Qualificação para Editais Cultura Viva 2026');
    expect(result.subEvents[0].venueName).toBe('Centro de Cabo Frio');
  });
});

describe('parseStructuredBlock — regressão real: detecção de marcador de agrupamento temporal (schedule_grouping_detected)', () => {
  const html =
    '<p><strong>SERVIÇO:</strong></p>' +
    '<p><strong>Sexta (5)</strong> – Luma e Banda Boteco Chic</p>' +
    '<p><strong>Sábado (6)</strong> – DJ Sid e Bossa Lounge</p>';

  it('marca cada sub-evento com reviewReason schedule_grouping_detected quando o título é só dia da semana + número', () => {
    const result = parseStructuredBlock(html, { year: 2026, month: 6 }, SERVICO_MARKER);
    expect(result.subEvents).toHaveLength(2);
    expect(result.subEvents.every((ev) => ev.reviewReason === 'schedule_grouping_detected')).toBe(true);
  });
});

describe('parseStructuredBlock — regressão real: descarte de rótulos informativos genéricos', () => {
  it.each([['Informações:'], ['Observações:'], ['Contato:']])(
    'descarta o rótulo genérico "%s" quando isolado, sem dado de agenda',
    (label) => {
      const html =
        `<p><strong>SERVIÇO:</strong></p><p><strong>Show de Música no Centro Cultural</strong><br>` +
        `Dia: 10 de julho de 2026<br>Horário: 19h</p><p><strong>${label}</strong> mais detalhes aqui</p>`;

      const result = parseStructuredBlock(html, { year: 2026, month: 7 }, SERVICO_MARKER);
      expect(result.subEvents).toHaveLength(1);
      expect(result.subEvents[0].title).toBe('Show de Música no Centro Cultural');
    },
  );
});
