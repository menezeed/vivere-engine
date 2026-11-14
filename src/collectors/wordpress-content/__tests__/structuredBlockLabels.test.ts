/**
 * Camada 1 — formatos rotulados observados em São Pedro da Aldeia e
 * Rio das Ostras (fixtures sintéticas, sem dados pessoais).
 */
import { describe, it, expect } from 'vitest';
import { parseStructuredBlock } from '../parsers/structuredBlockParser';
import { mapToRawActivityItems } from '../mapToRawActivityItems';
import { SAO_PEDRO_DA_ALDEIA_CONFIG } from '../config/sao-pedro-da-aldeia';

const MARKER = /<strong>\s*servi[çc]o:?\s*<\/strong>/i;
const REF = { year: 2026, month: 6 };

describe('Horário: com horário solto depois do rótulo', () => {
  it('"Horário: 17h" é reconhecido (o rótulo delimita o campo)', () => {
    const html = '<p><strong>SERVIÇO</strong></p><p><strong>Espetáculo</strong></p><p>Data: 8 de novembro de 2026</p><p>Horário: 17h</p>';
    const ev = parseStructuredBlock(html, REF, MARKER).subEvents[0]!;
    expect(ev.time).toBe('17:00');
    expect(ev.endTime).toBeNull();
    expect(ev.date).toBe('2026-11-08');
  });

  it('"Horário: 8h45" → 08:45', () => {
    const html = '<p><strong>SERVIÇO</strong></p><p><strong>Encontro</strong><br>Horário: 8h45</p>';
    expect(parseStructuredBlock(html, REF, MARKER).subEvents[0]!.time).toBe('08:45');
  });

  it('intervalo e preposição continuam iguais ("7h às 8h", "a partir das 19h")', () => {
    const range = '<p><strong>SERVIÇO:</strong></p><p><strong>Yoga</strong><br>Dia: 28 de junho de 2026<br>Horário: 7h às 8h</p>';
    expect(parseStructuredBlock(range, REF, MARKER).subEvents[0]).toMatchObject({ time: '07:00', endTime: '08:00' });
    const prep = '<p><strong>SERVIÇO:</strong></p><p><strong>Show</strong><br>Horário: a partir das 19h</p>';
    expect(parseStructuredBlock(prep, REF, MARKER).subEvents[0]).toMatchObject({ time: '19:00', endTime: null });
  });

  it('texto que não é horário continua sem horário ("Horário: a definir", "Horário: 2026")', () => {
    for (const value of ['a definir', '2026', '17 horas']) {
      const html = `<p><strong>SERVIÇO</strong></p><p><strong>Evento X</strong><br>Horário: ${value}</p>`;
      expect(parseStructuredBlock(html, REF, MARKER).subEvents[0]!.time).toBeNull();
    }
  });
});

describe('formato "Evento:" sem título em negrito (São Pedro da Aldeia, "Junho Violeta")', () => {
  const html =
    '<p>A Secretaria realiza um encontro especial.</p>' +
    '<p><strong>Serviço</strong></p>' +
    '<p>Evento: Encontro Junho Violeta<br>Data: Quarta-feira (17/06)<br>Horário: 8h45<br>Local: Teatro Municipal</p>';

  it('o título é exactamente o texto depois de "Evento:"; horário e local pelos rótulos', () => {
    const result = parseStructuredBlock(html, REF, MARKER);
    expect(result.found).toBe(true);
    expect(result.subEvents).toHaveLength(1);
    expect(result.subEvents[0]).toMatchObject({
      title: 'Encontro Junho Violeta',
      time: '08:45',
      venueName: 'Teatro Municipal',
    });
  });

  it('"Quarta-feira (17/06)" NÃO vira data: o ano não é inferido (ADR-0003) → revisão', () => {
    expect(parseStructuredBlock(html, REF, MARKER).subEvents[0]!.date).toBeNull();
    const mapped = mapToRawActivityItems(
      { id: 1, title: 'Junho Violeta', contentHtml: html, link: 'https://example.gov.br/1', publishedAt: { ...REF, isoDate: '2026-06-10T13:00:00' }, imageUrl: null },
      SAO_PEDRO_DA_ALDEIA_CONFIG,
    );
    expect(mapped.extractionMethod).toBe('structured_block');
    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0]!.title).toBe('Encontro Junho Violeta');
    expect(mapped.items[0]!.occurrences).toEqual([]);
    expect(mapped.items[0]!.venue_mention).toMatchObject({ raw_text: 'Teatro Municipal', confidence_hint: 'explicit_name' });
    expect(mapped.skipped.map((s) => s.reason)).toEqual(['structured_subevent_missing_date']);
  });

  it('com data explícita completa, a data é extraída', () => {
    const withYear = html.replace('Quarta-feira (17/06)', '17 de junho de 2026');
    expect(parseStructuredBlock(withYear, REF, MARKER).subEvents[0]!.date).toBe('2026-06-17');
  });

  it('vários "Evento:" geram vários sub-eventos, cada um com os seus rótulos', () => {
    const multi =
      '<p><strong>Serviço</strong></p>' +
      '<p>Evento: Oficina A<br>Data: 20 de junho de 2026<br>Local: Biblioteca</p>' +
      '<p>Evento: Oficina B<br>Data: 27 de junho de 2026<br>Horário: 14h às 16h</p>';
    const evs = parseStructuredBlock(multi, REF, MARKER).subEvents;
    expect(evs.map((e) => [e.title, e.date, e.time, e.venueName])).toEqual([
      ['Oficina A', '2026-06-20', null, 'Biblioteca'],
      ['Oficina B', '2026-06-27', '14:00', null],
    ]);
  });

  it('"Evento:" vazio não gera sub-evento', () => {
    const empty = '<p><strong>Serviço</strong></p><p>Evento:<br>Data: 20 de junho de 2026</p>';
    expect(parseStructuredBlock(empty, REF, MARKER).subEvents).toEqual([]);
  });

  it('não interfere quando o bloco tem títulos em negrito: "Evento:" dentro do sub-bloco é ignorado como antes', () => {
    const bold = '<p><strong>Serviço</strong></p><p><strong>Título em Negrito</strong><br>Evento: Outro Nome<br>Data: 20 de junho de 2026</p>';
    const evs = parseStructuredBlock(bold, REF, MARKER).subEvents;
    expect(evs).toHaveLength(1);
    expect(evs[0]!.title).toBe('Título em Negrito');
  });

  it('sem "Evento:" e sem negrito, continua a não gerar nada', () => {
    const none = '<p><strong>Serviço</strong></p><p>Data: 20 de junho de 2026<br>Local: Praça</p>';
    expect(parseStructuredBlock(none, REF, MARKER).subEvents).toEqual([]);
  });
});
