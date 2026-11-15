/**
 * src/collectors/wordpress-content/parsers/datePt.ts
 *
 * Reconhecimento CONSERVADOR de menções de data em texto livre em
 * português (pt-BR), para o WordPressContentCollector. Princípio
 * (ADR-0003): uma data errada é pior do que nenhuma data. Por isso:
 *
 *   - Só se reconhecem formas explícitas, com dia E (mês ou dia da
 *     semana) — nunca um "dia 27" solto.
 *   - O ano em falta é inferido por UMA regra explícita e testada
 *     (resolveYearNearReference): entre ano-1, ano e ano+1 da
 *     publicação, o candidato de calendário válido mais próximo do
 *     instante de publicação (empate → o futuro). É a mesma regra já
 *     usada no collector legado (resolveYearForDayMonth, Level 2).
 *   - O mês em falta ("sábado (17)", "quinta-feira, dia 22") só é
 *     inferido COM dia da semana: entre o mês anterior, o da publicação
 *     e o seguinte, só contam as datas cujo dia da semana coincide com
 *     o escrito; escolhe-se a mais próxima da publicação, e nunca a
 *     mais de MAX_WEEKDAY_DISTANCE_DAYS dias. Sem coincidência → sem
 *     data (fica registado como inconsistência).
 *   - Quando o texto junta dia da semana e data completa ("Domingo, 8
 *     de novembro") e o dia da semana NÃO bate com a data, a menção é
 *     marcada como inconsistente e não produz data.
 *   - Listas ("10, 11 e 12 de outubro", "dias 19 e 20 de dezembro")
 *     produzem várias menções (uma por dia) — quem chama decide; o
 *     parser narrativo trata-as como ambiguidade.
 *   - Intervalos explícitos ("de 10 a 12 de outubro") produzem uma
 *     menção com data inicial e final.
 *   - Datas numéricas: "21/10/2026" (dd/mm/aaaa, ordem brasileira).
 *     "dd/mm" sem ano só quando quem chama o permite (linhas rotuladas
 *     "Data:"/"Dia:"/"Início:"), porque em prosa "3/4" pode ser
 *     qualquer coisa.
 *
 * Referência temporal: o instante de publicação do post em UTC
 * (date_gmt interpretado por parseWordPressGmtDate, PR #10). As datas
 * produzidas são datas de calendário 'YYYY-MM-DD' (sem fuso), e todas
 * as contas de calendário usam UTC — nunca o fuso da máquina.
 *
 * Funções puras: nunca chamam Date.now() nem new Date() sem argumento.
 */

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0, segunda: 1, 'terça': 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, 'sábado': 6, sabado: 6,
};

/** Distância máxima (dias) entre a publicação e uma data inferida só por dia + dia da semana. */
export const MAX_WEEKDAY_DISTANCE_DAYS = 45;

/**
 * Distância máxima (dias) entre a publicação e uma data cujo ANO foi
 * inferido. Além disto (ex.: "20 de abril" num post de novembro), o ano
 * não é evidente e a data fica por resolver (revisão humana).
 */
export const MAX_YEAR_INFERENCE_DISTANCE_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_ALT = 'janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const WEEKDAY_ALT = 'domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado';
// Dia da semana como palavra inteira (exclui plurais "sábados"/"sextas" — recorrência, não data).
const WEEKDAY_WORD = `(?<![\\p{L}])(${WEEKDAY_ALT})(?:-feira)?(?![\\p{L}])`;
const ORD = '(?:º|°|o(?![\\p{L}]))?';
// Ano explícito depois do mês: "de 2027", " 2027", ", 2027" (só 19xx/20xx).
const YEAR_SUFFIX = '(?:\\s*,?\\s*(?:de\\s+)?((?:19|20)\\d{2})(?!\\d))?';
// Ano de 4 dígitos colado ao fim de uma menção mas NÃO consumido ("8 de novembro/2027", "– 2027"):
// o ano existe no texto, só não tem forma reconhecida → nunca se infere outro.
const UNCONSUMED_YEAR_AFTER = /^\s*[,/–-]?\s*(?:de\s+)?\d{4}(?!\d)/;

/**
 * Contexto de PASSADO explícito na frase da menção ("foi realizado em",
 * "aconteceu", "ocorreu", "realizou-se", "teve", "encerrou", "recebeu"…):
 * a data refere-se a algo já acontecido, por isso o ano/mês NÃO é inferido
 * (a janela de proximidade podia transformar uma retrospectiva de janeiro,
 * publicada em dezembro, num evento futuro). Na dúvida, sem data.
 */
const PAST_CONTEXT = new RegExp(
  '(?<![\\p{L}])(?:foi|foram|aconteceu|aconteceram|ocorreu|ocorreram|realizou(?:-se)?|realizaram(?:-se)?|' +
    'teve|tiveram|encerrou|encerraram|recebeu|receberam|participou|participaram|esteve|estiveram|' +
    'celebrou|celebraram|reuniu|reuniram|visitou|visitaram)(?![\\p{L}])',
  'iu',
);

/** Frase (entre . ! ? ; ou quebra de linha) que contém [start, end). */
function sentenceAround(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const from = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf(';'), before.lastIndexOf('\n')) + 1;
  const afterMatch = /[.!?;\n]/.exec(text.slice(end));
  const to = afterMatch ? end + afterMatch.index : text.length;
  return text.slice(from, to);
}

export interface DateMention {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'YYYY-MM-DD' quando a menção é um intervalo explícito; senão null. */
  endDate: string | null;
  /** Trecho exacto que originou a menção — auditoria. */
  matchedText: string;
  /** Posição no texto (início do trecho). */
  index: number;
  /** Fim do trecho (exclusivo). */
  end: number;
  kind: 'full' | 'day_month' | 'range' | 'list_item' | 'numeric' | 'weekday_day';
  /**
   * true quando a menção é um LIMITE ("até o dia 8 de novembro", "até a
   * próxima segunda-feira (12)", "até às 23h59 do dia 12/10/2026"): um
   * prazo ou o fim de uma exposição — não o dia de uma ocorrência.
   */
  until: boolean;
  /**
   * true quando o ANO ou o MÊS da data foi INFERIDO pela publicação (não
   * vem no texto). Independente do formato (`kind`): "21/10/2026" e "de
   * 10 a 12 de outubro de 2026" têm ano explícito → false.
   */
  inferred: boolean;
}

const UNTIL_BEFORE = new RegExp(
  '(?<![\\p{L}])até\\s+(?:(?:o|a|à|ao)\\s+)?(?:às?\\s+\\d{1,2}h\\d{0,2}\\s+)?(?:(?:próxim[oa]|dia|d[oa]|est[ae]|nest[ae])\\s+)*$',
  'iu',
);

function isUntilMention(text: string, index: number): boolean {
  return UNTIL_BEFORE.test(text.slice(Math.max(0, index - 40), index));
}

export interface DateInconsistency {
  matchedText: string;
  reason: 'weekday_mismatch' | 'invalid_calendar_date' | 'year_not_evident';
}

export interface DateScanResult {
  mentions: DateMention[];
  inconsistencies: DateInconsistency[];
}

export interface DateScanOptions {
  /** Aceitar "dd/mm" sem ano (só em valores de rótulos de agenda). */
  allowNumericWithoutYear?: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' se (y, m, d) for uma data de calendário real; senão null (nunca normaliza 31/02). */
export function toIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Dia da semana (0 = domingo) de uma data 'YYYY-MM-DD', em UTC. */
export function weekdayOf(iso: string): number {
  return new Date(isoToUtcMs(iso)).getUTCDay();
}

export function weekdayIndexPt(name: string): number | null {
  const key = name.toLowerCase().replace(/-feira$/, '');
  return WEEKDAYS[key] ?? null;
}

export function monthIndexPt(name: string): number | null {
  return MONTHS[name.toLowerCase()] ?? null;
}

/**
 * Regra de inferência do ANO (dia + mês conhecidos, ano em falta):
 * candidatos ano-1, ano e ano+1 do instante de referência (UTC);
 * descarta datas de calendário inválidas; escolhe a de menor distância
 * absoluta ao instante de referência; empate exacto → a mais futura; se
 * a escolhida estiver a mais de MAX_YEAR_INFERENCE_DISTANCE_DAYS da
 * publicação → null. Quando o texto traz também o dia da semana, quem
 * chama verifica-o contra a data resolvida (incoerente → sem data).
 *
 * Exemplos (referência = publicação):
 *   pub 2026-12-20, "10 de janeiro"  → 2027-01-10
 *   pub 2027-01-05, "20 de dezembro" → 2026-12-20
 *   pub 2026-10-29, "1º de novembro" → 2026-11-01
 */
export function resolveYearNearReference(day: number, month: number, reference: Date): string | null {
  const refMs = reference.getTime();
  if (Number.isNaN(refMs)) return null;
  const refYear = reference.getUTCFullYear();
  let best: { iso: string; ms: number; dist: number } | null = null;
  for (const year of [refYear - 1, refYear, refYear + 1]) {
    const iso = toIsoDate(year, month, day);
    if (!iso) continue;
    const ms = isoToUtcMs(iso);
    const dist = Math.abs(ms - refMs);
    if (!best || dist < best.dist || (dist === best.dist && ms > best.ms)) best = { iso, ms, dist };
  }
  // Guarda adicional: longe da publicação, o ano deixa de ser evidente.
  if (best && best.dist > MAX_YEAR_INFERENCE_DISTANCE_DAYS * DAY_MS) return null;
  return best ? best.iso : null;
}

/**
 * Regra de inferência do MÊS (só dia + dia da semana, ex.: "sábado
 * (17)"): candidatos no mês anterior, no da publicação e no seguinte
 * (UTC); ficam só os de calendário válido cujo dia da semana coincide;
 * escolhe o mais próximo da publicação, desde que a no máximo
 * MAX_WEEKDAY_DISTANCE_DAYS dias. Empate → o futuro. Nada → null.
 */
export function resolveDayWithWeekday(day: number, weekday: number, reference: Date): string | null {
  const refMs = reference.getTime();
  if (Number.isNaN(refMs)) return null;
  const refYear = reference.getUTCFullYear();
  const refMonth = reference.getUTCMonth(); // 0-based
  let best: { iso: string; ms: number; dist: number } | null = null;
  for (const offset of [-1, 0, 1]) {
    const first = new Date(Date.UTC(refYear, refMonth + offset, 1));
    const iso = toIsoDate(first.getUTCFullYear(), first.getUTCMonth() + 1, day);
    if (!iso || weekdayOf(iso) !== weekday) continue;
    const ms = isoToUtcMs(iso);
    const dist = Math.abs(ms - refMs);
    if (dist > MAX_WEEKDAY_DISTANCE_DAYS * DAY_MS) continue;
    if (!best || dist < best.dist || (dist === best.dist && ms > best.ms)) best = { iso, ms, dist };
  }
  return best ? best.iso : null;
}

/** Procura um dia da semana imediatamente antes de `index` ("Domingo, " / "sábado, dia "). */
function weekdayRightBefore(text: string, index: number): number | null {
  const before = text.slice(Math.max(0, index - 30), index);
  const m = before.match(new RegExp(`${WEEKDAY_WORD}\\s*[,(]?\\s*(?:dia\\s+)?$`, 'iu'));
  return m ? weekdayIndexPt(m[1]!) : null;
}

/** Procura um dia da semana imediatamente depois de `end` (", sábado" em "14 de novembro de 2026, sábado"). */
function weekdayRightAfter(text: string, end: number): number | null {
  const after = text.slice(end, end + 30);
  // Não conta um intervalo de dias da semana ("(segunda-feira a sexta-feira …").
  const m = after.match(new RegExp(`^\\s*[,(–-]\\s*${WEEKDAY_WORD}(?!(?:-feira)?\\s+(?:a|à|e)\\s)`, 'iu'));
  return m ? weekdayIndexPt(m[1]!) : null;
}

/**
 * Encontra todas as menções de data no texto. Os padrões mais
 * específicos correm primeiro e "consomem" o trecho, para que um
 * padrão mais genérico não volte a casar dentro dele (ex.: o "12 de
 * outubro" dentro de "de 10 a 12 de outubro").
 */
export function scanDateMentionsPt(text: string, reference: Date, options: DateScanOptions = {}): DateScanResult {
  const mentions: Array<Omit<DateMention, 'until'>> = [];
  const inconsistencies: DateInconsistency[] = [];
  const taken: Array<[number, number]> = [];
  const isFree = (s: number, e: number): boolean => taken.every(([a, b]) => e <= a || s >= b);
  const take = (s: number, e: number): void => {
    taken.push([s, e]);
  };

  const resolveDayMonth = (day: number, month: number, year: number | null): string | null =>
    year !== null ? toIsoDate(year, month, day) : resolveYearNearReference(day, month, reference);
  /** Sem ano e com dia/mês possíveis (2028 é bissexto) → o ano é que não é evidente. */
  const failReason = (day: number, month: number, year: number | null): DateInconsistency['reason'] =>
    year === null && toIsoDate(2028, month, day) ? 'year_not_evident' : 'invalid_calendar_date';

  /**
   * Para menções SEM ano explícito: devolve false (e regista porquê, quando
   * é uma inconsistência) se a inferência não deve acontecer:
   *   - há um ano de 4 dígitos colado ao fim da menção que não foi consumido;
   *   - a frase tem contexto de passado explícito (retrospectiva) — a menção
   *     é simplesmente ignorada (não é candidata).
   */
  const inferenceAllowed = (start: number, end: number, matched: string): boolean => {
    if (UNCONSUMED_YEAR_AFTER.test(text.slice(end, end + 12))) {
      inconsistencies.push({ matchedText: matched, reason: 'year_not_evident' });
      return false;
    }
    return !PAST_CONTEXT.test(sentenceAround(text, start, end));
  };

  const checkWeekday = (iso: string, start: number, end: number, matched: string): boolean => {
    const wd = weekdayRightBefore(text, start) ?? weekdayRightAfter(text, end);
    if (wd !== null && weekdayOf(iso) !== wd) {
      inconsistencies.push({ matchedText: matched, reason: 'weekday_mismatch' });
      return false;
    }
    return true;
  };

  // 1. Intervalo: "de 10 a 12 de outubro [de 2026]", "10 a 12 de outubro".
  const rangeRe = new RegExp(
    `(?<!\\d)(?:de\\s+)?(\\d{1,2})${ORD}\\s+(?:a|até)\\s+(?:o\\s+dia\\s+)?(\\d{1,2})${ORD}\\s+de\\s+(${MONTH_ALT})(?![\\p{L}])${YEAR_SUFFIX}`,
    'giu',
  );
  for (const m of text.matchAll(rangeRe)) {
    const s = m.index!, e = s + m[0].length;
    if (!isFree(s, e)) continue;
    take(s, e);
    const month = monthIndexPt(m[3]!)!;
    const year = m[4] ? Number(m[4]) : null;
    if (year === null && !inferenceAllowed(s, e, m[0])) continue;
    const startDay = Number(m[1]), endDay = Number(m[2]);
    const startIso = resolveDayMonth(startDay, month, year);
    const endIso = startIso ? toIsoDate(Number(startIso.slice(0, 4)), month, endDay) : null;
    if (!startIso || !endIso || endDay <= startDay) {
      inconsistencies.push({ matchedText: m[0], reason: startIso ? 'invalid_calendar_date' : failReason(startDay, month, year) });
      continue;
    }
    // Mesma regra das datas simples: dia da semana junto do intervalo tem de bater com o 1.º dia.
    if (!checkWeekday(startIso, s, e, m[0])) continue;
    mentions.push({ date: startIso, endDate: endIso, matchedText: m[0], index: s, end: e, kind: 'range', inferred: year === null });
  }

  // 2. Lista: "10, 11 e 12 de outubro", "dias 19 e 20 de dezembro" → uma menção por dia.
  const listRe = new RegExp(
    `(?<!\\d)(\\d{1,2}${ORD}(?:\\s*,\\s*\\d{1,2}${ORD})*\\s+e\\s+\\d{1,2})${ORD}\\s+de\\s+(${MONTH_ALT})(?![\\p{L}])${YEAR_SUFFIX}`,
    'giu',
  );
  for (const m of text.matchAll(listRe)) {
    const s = m.index!, e = s + m[0].length;
    if (!isFree(s, e)) continue;
    take(s, e);
    const month = monthIndexPt(m[2]!)!;
    const year = m[3] ? Number(m[3]) : null;
    if (year === null && !inferenceAllowed(s, e, m[0])) continue;
    const days = m[1]!.split(/\s*(?:,|\be\b)\s*/).map((d) => Number(d.replace(/\D/g, ''))).filter((d) => d > 0);
    for (const day of days) {
      const iso = resolveDayMonth(day, month, year);
      if (!iso) {
        inconsistencies.push({ matchedText: m[0], reason: failReason(day, month, year) });
        continue;
      }
      mentions.push({ date: iso, endDate: null, matchedText: m[0], index: s, end: e, kind: 'list_item', inferred: year === null });
    }
  }

  // 3. Dia + mês por extenso, com ou sem ano: "8 de novembro", "1º de outubro de 2026",
  //    "8 de novembro 2027", "8 de novembro, 2027".
  const dayMonthRe = new RegExp(`(?<!\\d)(\\d{1,2})${ORD}\\s+de\\s+(${MONTH_ALT})(?![\\p{L}])${YEAR_SUFFIX}`, 'giu');
  for (const m of text.matchAll(dayMonthRe)) {
    const s = m.index!, e = s + m[0].length;
    if (!isFree(s, e)) continue;
    take(s, e);
    const month = monthIndexPt(m[2]!)!;
    const year = m[3] ? Number(m[3]) : null;
    if (year === null && !inferenceAllowed(s, e, m[0])) continue;
    const iso = resolveDayMonth(Number(m[1]), month, year);
    if (!iso) {
      inconsistencies.push({ matchedText: m[0], reason: failReason(Number(m[1]), month, year) });
      continue;
    }
    if (!checkWeekday(iso, s, e, m[0])) continue;
    mentions.push({ date: iso, endDate: null, matchedText: m[0], index: s, end: e, kind: year !== null ? 'full' : 'day_month', inferred: year === null });
  }

  // 4. Numérica: "21/10/2026" (sempre); "21/10" só com allowNumericWithoutYear.
  const numericRe = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?![\d/])/g;
  for (const m of text.matchAll(numericRe)) {
    const s = m.index!, e = s + m[0].length;
    if (!isFree(s, e)) continue;
    if (!m[3] && !options.allowNumericWithoutYear) continue;
    take(s, e);
    if (!m[3] && !inferenceAllowed(s, e, m[0])) continue;
    const day = Number(m[1]), month = Number(m[2]);
    const iso = m[3] ? toIsoDate(Number(m[3]), month, day) : (month >= 1 && month <= 12 ? resolveYearNearReference(day, month, reference) : null);
    if (!iso) {
      inconsistencies.push({ matchedText: m[0], reason: failReason(day, month, m[3] ? Number(m[3]) : null) });
      continue;
    }
    if (!checkWeekday(iso, s, e, m[0])) continue;
    mentions.push({ date: iso, endDate: null, matchedText: m[0], index: s, end: e, kind: 'numeric', inferred: !m[3] });
  }

  // 5. Só dia + dia da semana: "sábado (17)", "terça (03)", "quinta-feira, dia 22", "sábado, 10".
  const weekdayDayRe = new RegExp(
    `${WEEKDAY_WORD}(?:\\s*\\(\\s*(\\d{1,2})${ORD}\\s*\\)|\\s*,\\s*(?:dia\\s+)?(\\d{1,2})${ORD}(?![\\d/:hH]|\\s*(?:de\\s+\\p{L}|h\\b))|\\s+dia\\s+(\\d{1,2})${ORD}(?![\\d/:hH]|\\s*de\\s+\\p{L}))`,
    'giu',
  );
  for (const m of text.matchAll(weekdayDayRe)) {
    const s = m.index!, e = s + m[0].length;
    if (!isFree(s, e)) continue;
    take(s, e);
    if (!inferenceAllowed(s, e, m[0])) continue;
    const weekday = weekdayIndexPt(m[1]!)!;
    const day = Number(m[2] ?? m[3] ?? m[4]);
    const iso = resolveDayWithWeekday(day, weekday, reference);
    if (!iso) {
      inconsistencies.push({ matchedText: m[0], reason: 'weekday_mismatch' });
      continue;
    }
    mentions.push({ date: iso, endDate: null, matchedText: m[0], index: s, end: e, kind: 'weekday_day', inferred: true });
  }

  mentions.sort((a, b) => a.index - b.index);
  return { mentions: mentions.map((m) => ({ ...m, until: isUntilMention(text, m.index) })), inconsistencies };
}

/** Datas distintas (date + endDate) de um conjunto de menções, por ordem de aparição. */
export function distinctDates(mentions: readonly DateMention[]): Array<{ date: string; endDate: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ date: string; endDate: string | null }> = [];
  for (const m of mentions) {
    const key = `${m.date}|${m.endDate ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: m.date, endDate: m.endDate });
  }
  return out;
}

/**
 * Valor de um rótulo de agenda ("Data: Domingo, 8 de novembro",
 * "Dia: 21/10/2026", "De 10 a 12 de outubro, das 13h às 17h"):
 * devolve a data SÓ quando há exactamente uma data distinta e nenhuma
 * inconsistência; caso contrário null. `rest` é o texto depois da
 * última menção (para ler o horário na mesma linha).
 */
export function parseSingleLabeledDate(
  value: string,
  reference: Date,
): { date: string; endDate: string | null; rest: string } | null {
  const { mentions, inconsistencies } = scanDateMentionsPt(value, reference, { allowNumericWithoutYear: true });
  if (inconsistencies.length > 0 || mentions.some((m) => m.until)) return null;
  const dates = distinctDates(mentions);
  if (dates.length !== 1) return null;
  const last = mentions[mentions.length - 1]!;
  return { ...dates[0]!, rest: value.slice(last.end) };
}

/**
 * Referência temporal de um post. `referenceDate` é o instante de
 * publicação (UTC, via parseWordPressGmtDate — PR #10). Quando quem
 * chama só fornece ano/mês, a referência é o dia 1 desse mês, 00:00 UTC.
 */
export interface PublicationReference {
  year: number;
  month: number;
  referenceDate?: Date;
}

export function referenceInstant(ref: PublicationReference): Date {
  return ref.referenceDate && !Number.isNaN(ref.referenceDate.getTime())
    ? ref.referenceDate
    : new Date(Date.UTC(ref.year, ref.month - 1, 1));
}
