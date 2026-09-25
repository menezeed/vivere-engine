/**
 * src/collectors/prefeitura-agenda-cultural/parsers/__tests__/servicoBlockParser.test.ts
 *
 * Level 2, 2026-09-24 — regressão FLIC (Explicit day+month parsing).
 *
 * ⚠ Se já existir um arquivo de teste com este nome, NÃO sobrescrever
 * cegamente — confirmar primeiro com Test-Path e mesclar manualmente
 * com os testes já existentes (não confirmei nesta sessão se já há
 * testes de servicoBlockParser além destes).
 *
 * O fixture HTML abaixo é uma RECONSTRUÇÃO plausível, não o HTML bruto
 * original do WordPress — só vi o raw_text já convertido para texto
 * puro (pós stripHtmlToText), gravado em raw_activity_items.raw_payload,
 * nunca o HTML original com as tags <strong>. Reconstrói a estrutura
 * mínima necessária (marcador "SERVIÇO:", <strong>título</strong>,
 * conteúdo solto a seguir) para exercitar o mesmo caminho de código
 * real, usando o texto real do título ("17 de setembro (quinta-feira)")
 * confirmado por consulta directa à base de dados.
 *
 * IMPORTANTE: os fixtures abaixo são deliberadamente escritos SEM
 * indentação antes de cada tag — comportamento pré-existente e fora
 * do escopo desta correcção: parseSubBlock() usa /^(dia|data)\s*:/i
 * (ancorado ao início da linha) para reconhecer linhas rotuladas;
 * texto indentado como HTML real nunca vem, mas um fixture de teste
 * com indentação (comum ao formatar código) introduz um espaço à
 * esquerda por linha depois de stripHtmlToText, fazendo esse
 * reconhecimento falhar — achado durante a escrita destes testes,
 * documentado aqui, não corrigido (fora de escopo; HTML real do
 * WordPress não tem esta indentação).
 */

import { describe, it, expect } from 'vitest';
import { parseServicoBlock } from '../servicoBlockParser';

describe('parseServicoBlock — regressão FLIC (Level 2, 2026-09-24)', () => {
  it('sub-evento "17 de setembro (quinta-feira)" — ANTES produzia date:null (occurrences:[] a jusante), AGORA produz a data correcta', () => {
    const html = '<p>Confira a programação completa da 11ª FLIC:</p>'
      + '<p><strong>SERVIÇO:</strong></p>'
      + '<p><strong>17 de setembro (quinta-feira)</strong></p>'
      + '<p>14h — Abertura Oficial</p>'
      + '<p>Show e Cortejo Brincante com Azul Mirim e a Turma da Tia Carol</p>';

    const result = parseServicoBlock(html, { year: 2026, month: 9 });

    expect(result.found).toBe(true);
    expect(result.subEvents).toHaveLength(1);
    expect(result.subEvents[0]!.title).toBe('17 de setembro (quinta-feira)');
    // Antes desta correcção: null. Confirmado por consulta directa à
    // base de dados real (raw_activity_items, source_item_id 115382_0).
    expect(result.subEvents[0]!.date).toBe('2026-09-17');
  });

  it('sub-evento "18 de setembro (sexta-feira)" — mesmo padrão, segundo item real da FLIC', () => {
    const html = '<p><strong>SERVIÇO:</strong></p>'
      + '<p><strong>18 de setembro (sexta-feira)</strong></p>'
      + '<p>8h — Contação de Histórias</p>';

    const result = parseServicoBlock(html, { year: 2026, month: 9 });
    expect(result.subEvents[0]!.date).toBe('2026-09-18');
  });

  it('sub-evento "19 de setembro (sábado)" — terceiro item real da FLIC', () => {
    const html = '<p><strong>SERVIÇO:</strong></p>'
      + '<p><strong>19 de setembro (sábado)</strong></p>'
      + '<p>14h — Apresentação Musical</p>';

    const result = parseServicoBlock(html, { year: 2026, month: 9 });
    expect(result.subEvents[0]!.date).toBe('2026-09-19');
  });

  it('formato numérico "(17/06)" dentro de uma linha "Data:" rotulada resolve pela mesma função partilhada', () => {
    const html = '<p><strong>SERVIÇO:</strong></p>'
      + '<p><strong>Junho Violeta – Encontro Especial para a população 60+</strong></p>'
      + '<p>Data: Quarta-feira (17/06)</p>'
      + '<p>Horário: 8h45</p>'
      + '<p>Local: Teatro Municipal Dr. Átila Costa</p>';

    // Post publicado em Junho de 2026 — mesmo mês do evento, caso simples.
    const result = parseServicoBlock(html, { year: 2026, month: 6 });

    expect(result.subEvents[0]!.date).toBe('2026-06-17');
  });

  it('não regride nenhum dos formatos já suportados: "Dia: 28 de junho de 2026" continua a funcionar via parseExplicitDatePt, sem passar pelo novo fallback', () => {
    const html = '<p><strong>SERVIÇO:</strong></p>'
      + '<p><strong>Yoga no Forte</strong></p>'
      + '<p>Dia: 28 de junho de 2026</p>'
      + '<p>Horário: 7h às 8h</p>'
      + '<p>Local: Praia do Forte</p>';

    const result = parseServicoBlock(html, { year: 2026, month: 6 });
    expect(result.subEvents[0]!.date).toBe('2026-06-28');
  });

  it('não regride o formato (dd) isolado já suportado: "sexta-feira (26)" continua a usar combineDayWithReference, não o novo fallback', () => {
    const html = '<p><strong>SERVIÇO:</strong></p>'
      + '<p><strong>sexta-feira (26)</strong></p>'
      + '<p>16h — Show</p>';

    const result = parseServicoBlock(html, { year: 2026, month: 6 });
    expect(result.subEvents[0]!.date).toBe('2026-06-26');
  });
});
