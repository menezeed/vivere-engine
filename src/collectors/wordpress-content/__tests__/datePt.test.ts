/**
 * Datas em pt-BR (datePt.ts) — fixtures SINTÉTICAS curtas, modeladas nos
 * padrões vistos nos posts reais de Cabo Frio e Rio das Ostras (11/2026).
 * Nenhum texto é copiado das fontes.
 *
 * Calendário de referência (verificado): 2026-10-03 sábado, 2026-10-10
 * sábado, 2026-10-21 quarta, 2026-10-31 sábado, 2026-11-03 terça,
 * 2026-11-08 domingo, 2026-12-26 sábado, 2027-01-10 domingo.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveYearNearReference,
  resolveDayWithWeekday,
  scanDateMentionsPt,
  parseSingleLabeledDate,
  toIsoDate,
  weekdayOf,
  MAX_WEEKDAY_DISTANCE_DAYS,
  MAX_YEAR_INFERENCE_DISTANCE_DAYS,
} from '../parsers/datePt';
import { parseWordPressGmtDate } from '../../../lib/wordpressDates';

const utc = (iso: string): Date => parseWordPressGmtDate(iso);
const dates = (text: string, ref: Date) => scanDateMentionsPt(text, ref).mentions.map((m) => [m.date, m.endDate, m.kind]);

describe('toIsoDate / weekdayOf', () => {
  it('rejeita datas de calendário impossíveis em vez de as normalizar', () => {
    expect(toIsoDate(2026, 2, 31)).toBeNull();
    expect(toIsoDate(2026, 13, 1)).toBeNull();
    expect(toIsoDate(2028, 2, 29)).toBe('2028-02-29');
  });
  it('dia da semana em UTC, independente do fuso da máquina', () => {
    expect(weekdayOf('2026-11-08')).toBe(0); // domingo
    expect(weekdayOf('2026-10-31')).toBe(6); // sábado
  });
});

describe('resolveYearNearReference — regra explícita do ANO (ano-1/ano/ano+1, o mais próximo da publicação)', () => {
  it('mesmo ano quando a data está perto da publicação', () => {
    expect(resolveYearNearReference(8, 11, utc('2026-11-06T17:16:01'))).toBe('2026-11-08');
  });
  it('publicado em dezembro, "10 de janeiro" → ano seguinte', () => {
    expect(resolveYearNearReference(10, 1, utc('2026-12-20T12:00:00'))).toBe('2027-01-10');
  });
  it('publicado em janeiro, "20 de dezembro" → ano anterior', () => {
    expect(resolveYearNearReference(20, 12, utc('2027-01-05T12:00:00'))).toBe('2026-12-20');
  });
  it('29 de fevereiro só existe nos anos bissextos candidatos', () => {
    expect(resolveYearNearReference(29, 2, utc('2027-12-01T00:00:00'))).toBe('2028-02-29');
    expect(resolveYearNearReference(29, 2, utc('2026-06-01T00:00:00'))).toBeNull();
  });
  it('a referência é o instante UTC do date_gmt: 31/12 23:30 UTC + "2 de janeiro" → ano seguinte', () => {
    expect(resolveYearNearReference(2, 1, utc('2026-12-31T23:30:00'))).toBe('2027-01-02');
  });
  it(`a mais de ${MAX_YEAR_INFERENCE_DISTANCE_DAYS} dias da publicação o ano não é evidente → null`, () => {
    // post de 15/11: "20 de abril" fica a ~150 dias de qualquer ano candidato
    expect(resolveYearNearReference(20, 4, utc('2026-11-15T12:00:00'))).toBeNull();
    expect(resolveYearNearReference(10, 3, utc('2026-11-15T12:00:00'))).toBe('2027-03-10'); // 115 dias
  });
});

describe('resolveDayWithWeekday — regra explícita do MÊS (só com dia da semana)', () => {
  it('"terça (03)" publicado a 29/10 → 03/11 (terça), nunca 03/10 (sábado)', () => {
    expect(resolveDayWithWeekday(3, 2, utc('2026-10-29T18:32:24'))).toBe('2026-11-03');
  });
  it('"sábado (31)" publicado a 01/11 01:00 UTC (ainda 31/10 em Brasília) → 31/10', () => {
    expect(resolveDayWithWeekday(31, 6, utc('2026-11-01T01:00:00'))).toBe('2026-10-31');
  });
  it('dia da semana que não bate com nenhum mês candidato → null', () => {
    // 20/09 domingo, 20/10 terça, 20/11 sexta: "quarta (20)" é incoerente.
    expect(resolveDayWithWeekday(20, 3, utc('2026-10-14T18:00:00'))).toBeNull();
  });
  it(`nunca a mais de ${MAX_WEEKDAY_DISTANCE_DAYS} dias da publicação`, () => {
    // Publicado a 01/10: 30/09 é quarta e 30/10 é sexta; só 30/11 é
    // segunda, mas está a ~60 dias (fora da janela) → null.
    expect(resolveDayWithWeekday(30, 1, utc('2026-10-01T12:00:00'))).toBeNull();
    // A mesma regra aceita o vizinho próximo: "quarta (30)" → 30/09.
    expect(resolveDayWithWeekday(30, 3, utc('2026-10-01T12:00:00'))).toBe('2026-09-30');
  });
});

describe('scanDateMentionsPt — padrões reconhecidos', () => {
  const ref = utc('2026-10-07T15:00:00');

  it('data completa, com "1º" e mês com maiúscula', () => {
    expect(dates('Data: 17 de Outubro de 2026', ref)).toEqual([['2026-10-17', null, 'full']]);
    expect(dates('abre no dia 1º de novembro de 2026', ref)).toEqual([['2026-11-01', null, 'full']]);
  });
  it('dia + mês sem ano', () => {
    expect(dates('no próximo domingo, dia 8 de novembro', ref)).toEqual([['2026-11-08', null, 'day_month']]);
  });
  it('intervalo "de 10 a 12 de outubro" → data inicial e final', () => {
    expect(dates('De 10 a 12 de outubro, das 13h às 17h', ref)).toEqual([['2026-10-10', '2026-10-12', 'range']]);
  });
  it('lista "10, 11 e 12 de outubro" → uma menção por dia (nunca só o último)', () => {
    expect(dates('Data: 10, 11 e 12 de outubro', ref)).toEqual([
      ['2026-10-10', null, 'list_item'],
      ['2026-10-11', null, 'list_item'],
      ['2026-10-12', null, 'list_item'],
    ]);
  });
  it('numérica dd/mm/aaaa sempre; dd/mm só quando permitido (rótulos)', () => {
    expect(dates('Dia: 21/10/2026', ref)).toEqual([['2026-10-21', null, 'numeric']]);
    expect(dates('placar de 3/4 na final', ref)).toEqual([]);
    expect(scanDateMentionsPt('Início: 5/11', ref, { allowNumericWithoutYear: true }).mentions.map((m) => m.date)).toEqual(['2026-11-05']);
  });
  it('números de documentos não são datas ("Edital nº 46/2026", "Lei 3281/2026")', () => {
    expect(dates('Edital nº 46/2026 e Lei nº 3281/2026', ref)).toEqual([]);
  });
  it('dia da semana + dia: "(17)", "(01º)", ", dia 22", ", 10"', () => {
    expect(dates('neste sábado (17), a partir das 18h', ref)).toEqual([['2026-10-17', null, 'weekday_day']]);
    expect(dates('nesta quinta-feira, dia 22, às 19h30', ref)).toEqual([['2026-10-22', null, 'weekday_day']]);
    expect(dates('começa neste sábado, 10, com show', ref)).toEqual([['2026-10-10', null, 'weekday_day']]);
    expect(dates('abriu nesta quinta-feira (01º) as inscrições', utc('2026-10-01T20:25:00'))).toEqual([['2026-10-01', null, 'weekday_day']]);
  });
  it('"sexta, 18h" não é dia 18; plural "aos sábados" não é data', () => {
    expect(dates('na sexta, 18h, no teatro', ref)).toEqual([]);
    expect(dates('aos sábados, 10 vagas por turma', ref)).toEqual([]);
  });
  it('dia da semana junto da data completa tem de bater, senão é inconsistência', () => {
    const ok = scanDateMentionsPt('Data: Domingo, 8 de novembro', ref);
    expect(ok.mentions.map((m) => m.date)).toEqual(['2026-11-08']);
    const bad = scanDateMentionsPt('Data: Sábado, 8 de novembro', ref);
    expect(bad.mentions).toEqual([]);
    expect(bad.inconsistencies).toEqual([{ matchedText: '8 de novembro', reason: 'weekday_mismatch' }]);
    // "(segunda-feira a sexta-feira …)" depois da data é um intervalo de dias, não o dia da data.
    expect(scanDateMentionsPt('até dia 31 de outubro (segunda-feira a sexta-feira)', ref).inconsistencies).toEqual([]);
  });
  it('menções de LIMITE ("até …") ficam marcadas como until', () => {
    const scan = scanDateMentionsPt(
      'inscrições até o dia 8 de novembro; prazo até às 23h59 do dia 12/10/2026; segue até a próxima segunda-feira (12); show no sábado (10)',
      ref,
    );
    expect(scan.mentions.map((m) => [m.date, m.until])).toEqual([
      ['2026-11-08', true],
      ['2026-10-12', true],
      ['2026-10-12', true],
      ['2026-10-10', false],
    ]);
  });
});

describe('parseSingleLabeledDate — valor de rótulo de agenda', () => {
  const ref = utc('2026-10-29T20:52:27');
  it('uma data → data + resto da linha (para o horário)', () => {
    expect(parseSingleLabeledDate('Sábado, 26 de Setembro – 18h', utc('2026-09-24T17:58:08'))).toEqual({
      date: '2026-09-26',
      endDate: null,
      rest: ' – 18h',
    });
  });
  it('várias datas, lista, limite ou dia da semana errado → null', () => {
    expect(parseSingleLabeledDate('10, 11 e 12 de outubro', ref)).toBeNull();
    expect(parseSingleLabeledDate('Em cartaz até o dia 28 de novembro', ref)).toBeNull();
    expect(parseSingleLabeledDate('Sexta-feira, 31 de outubro', ref)).toBeNull(); // 31/10/2026 é sábado
    expect(parseSingleLabeledDate('a definir', ref)).toBeNull();
  });
});

describe('revisão r0 do PR #24', () => {
  const ref = utc('2026-11-01T12:00:00');
  const dez = utc('2026-12-20T12:00:00');

  it('1. ano sem "de": "8 de novembro 2027" e "8 de novembro, 2027" → 2027, nunca 2026', () => {
    expect(dates('Data: 8 de novembro 2027', ref)).toEqual([['2027-11-08', null, 'full']]);
    expect(dates('Data: 8 de novembro, 2027', ref)).toEqual([['2027-11-08', null, 'full']]);
    expect(dates('Data: 8 de novembro de 2027', ref)).toEqual([['2027-11-08', null, 'full']]);
    expect(parseSingleLabeledDate('8 de novembro 2027', ref)).toMatchObject({ date: '2027-11-08' });
  });

  it('1. ano de 4 dígitos colado mas não consumido ("8 de novembro/2027", "– 2027") → recusa a inferência', () => {
    const scan = scanDateMentionsPt('Data: 8 de novembro/2027', ref);
    expect(scan.mentions).toEqual([]);
    expect(scan.inconsistencies).toEqual([{ matchedText: '8 de novembro', reason: 'year_not_evident' }]);
    expect(parseSingleLabeledDate('8 de novembro – 2027', ref)).toBeNull();
  });

  it('2. contexto de passado explícito na frase → ano/mês NÃO inferido (retrospectiva não vira evento futuro)', () => {
    expect(dates('O concerto foi realizado em 10 de janeiro, às 19h.', dez)).toEqual([]);
    for (const verbo of ['foi realizada', 'aconteceu', 'ocorreu', 'foram', 'realizou-se', 'teve início', 'encerrou', 'recebeu o público']) {
      expect(dates(`O festival ${verbo} no sábado (12) e em 10 de janeiro.`, dez)).toEqual([]);
    }
    // a mesma frase no futuro → inferência normal
    expect(dates('O concerto será realizado em 10 de janeiro, às 19h.', dez)).toEqual([['2027-01-10', null, 'day_month']]);
    // só a frase no passado perde a data; a frase seguinte, futura, mantém-na
    expect(dates('A 1.ª edição foi em 10 de janeiro. A próxima será em 14 de fevereiro.', dez)).toEqual([['2027-02-14', null, 'day_month']]);
  });

  it('2. ano explícito não depende do contexto de passado', () => {
    expect(dates('O concerto foi realizado em 10 de janeiro de 2026.', dez)).toEqual([['2026-01-10', null, 'full']]);
  });

  it('3. intervalo com dia da semana incoerente → inconsistência (10/11/2026 é terça)', () => {
    const bad = scanDateMentionsPt('Data: domingo, de 10 a 12 de novembro de 2026', ref);
    expect(bad.mentions).toEqual([]);
    expect(bad.inconsistencies.map((i) => i.reason)).toEqual(['weekday_mismatch']);
    expect(parseSingleLabeledDate('domingo, de 10 a 12 de novembro de 2026', ref)).toBeNull();
    expect(dates('Data: terça, de 10 a 12 de novembro de 2026', ref)).toEqual([['2026-11-10', '2026-11-12', 'range']]);
  });

  it('4. "inferred" separa ano/mês inferido do formato da menção', () => {
    const scan = scanDateMentionsPt('21/10/2026; de 3 a 5 de outubro de 2026; 8 de novembro; sábado (7)', ref);
    expect(scan.mentions.map((m) => [m.date, m.kind, m.inferred])).toEqual([
      ['2026-10-21', 'numeric', false],
      ['2026-10-03', 'range', false],
      ['2026-11-08', 'day_month', true],
      ['2026-11-07', 'weekday_day', true],
    ]);
  });
});
