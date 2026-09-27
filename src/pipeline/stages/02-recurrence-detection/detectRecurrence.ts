/**
 * src/pipeline/stages/02-recurrence-detection/detectRecurrence.ts
 *
 * Activity 8/26, 2026-09-26.
 *
 * Função pura: RawActivityItem → RecurrenceDetectionResult. Zero
 * acesso a banco, zero efeitos colaterais. Reutiliza parseTimeRangePt
 * (sharedTextUtils.ts, prefeitura-agenda-cultural) — não duplica
 * parsing de horário já existente.
 *
 * Só implementa detecção de recorrência SEMANAL (weekly) — os 4
 * padrões reais confirmados nesta Activity (staging.raw_activity_items,
 * prefeitura_iguaba_grande) são todos semanais. daily/biweekly/monthly
 * já são valores válidos no contrato (Activity 7), mas NENHUMA fonte
 * real observada até agora exige a sua detecção — implementá-los sem
 * evidência seria "inventar suporte para gramática que nenhuma fonte
 * real exige" (instrução explícita desta Activity). Ficam para quando
 * houver evidência real.
 *
 * Estratégia de distinção B/C vs D (Level 2, 2026-09-26, confirmada
 * por execução real contra os 4 casos-teste antes desta entrega):
 * conta quantos intervalos de horário distintos ("Xh às Yh") aparecem
 * no texto. Um único intervalo aplica-se a todos os dias detectados
 * (Casos B/C — "Quartas e sextas das 9h às 11h", um horário
 * partilhado). Dois ou mais intervalos significa horários DIFERENTES
 * por dia (Caso D — "Terças ... e sextas ..."), que o contrato actual
 * (um recurrence_time único) não consegue representar fielmente — daí
 * NUNCA escolher um dos dois arbitrariamente, recurrence_time fica
 * NULL, sinalizado via review_reasons, evidência completa preservada
 * em recurrence_text_hint.
 */

import { parseTimeRangePt } from '../../../collectors/prefeitura-agenda-cultural/parsers/sharedTextUtils.js';
import type { RawActivityItem } from '../../../types/RawActivityItem.js';
import type { RecurrenceDetectedItem, RecurrenceReviewReason } from './types.js';

const WEEKDAY_TO_NUMBER: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  'terça': 2,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  'sábado': 6,
  sabado: 6,
};

// Nome do dia + 's' plural opcional + '-feira'/'feira' opcional (com 's' plural opcional).
// Ex: "sexta", "sextas", "sexta-feira", "sextas-feiras" — todos casam.
const DAY_PATTERN = /(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)s?(?:-?feiras?)?/gi;

// Mesmo padrão usado internamente por parseTimeRangePt — usado aqui só
// para CONTAR quantos intervalos distintos existem, nunca para extrair
// o valor final (isso continua sendo parseTimeRangePt, reutilizado).
const TIME_RANGE_COUNT_PATTERN = /\d{1,2}h\d{0,2}\s+(?:às|as)\s+\d{1,2}h\d{0,2}/gi;

// Level 2, 2026-09-26 — achado real: um nome de dia da semana sozinho
// aparece com frequência em texto puramente editorial/noticioso (ex:
// "resultado da eleição de sexta-feira"), sem nenhuma recorrência
// genuína. Confirmado por execução real contra um caso deste tipo,
// nesta Activity. Para reduzir falsos positivos sem exigir gramática
// que nenhuma fonte real usa, só considera recorrência quando o texto
// tem ADICIONALMENTE um destes dois sinais — presentes em todos os 4
// padrões reais confirmados: a palavra "todo/toda/todos/todas", ou um
// intervalo de horário explícito ("Xh às Yh"). Nenhum dos dois exige
// inventar gramática nova — ambos já aparecem nos padrões reais.
const RECURRENCE_SIGNAL_PATTERN = /\btod[ao]s?\b/i;

function hasRecurrenceSignal(text: string): boolean {
  return RECURRENCE_SIGNAL_PATTERN.test(text) || TIME_RANGE_COUNT_PATTERN.test(text);
}

function detectWeekdays(text: string): number[] {
  const days = new Set<number>();
  const pattern = new RegExp(DAY_PATTERN);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const base = match[1]!.toLowerCase();
    const num = WEEKDAY_TO_NUMBER[base];
    if (num !== undefined) days.add(num);
  }
  return [...days].sort((a, b) => a - b);
}

function countTimeRanges(text: string): number {
  const matches = text.match(TIME_RANGE_COUNT_PATTERN);
  return matches ? matches.length : 0;
}

/**
 * Texto candidato para detecção: title + description. RawActivityItem
 * não tem um campo dedicado de "texto de horário" — estes dois campos
 * são os únicos garantidamente presentes em qualquer Collector. Fonte
 * mais rica por Collector (ex: raw_payload.raw_text) fica fora de
 * escopo aqui, deliberadamente — evita depender de uma forma não
 * tipada e específica de cada Collector.
 */
function buildCandidateText(item: RawActivityItem): string {
  return [item.title, item.description ?? ''].filter(Boolean).join(' ');
}

/**
 * Detecta recorrência numa única RawActivityItem. Não modifica o item
 * — devolve sempre um par { item, recurrence }, com item sendo um
 * objecto NOVO (spread) quando recurrence_text_hint é populado, ou o
 * mesmo objecto de entrada quando nada é detectado (nenhuma mutação
 * em qualquer dos dois casos).
 */
export function detectRecurrence(item: RawActivityItem): RecurrenceDetectedItem {
  const candidateText = buildCandidateText(item);
  const days = detectWeekdays(candidateText);

  if (days.length === 0 || !hasRecurrenceSignal(candidateText)) {
    // Nenhuma recorrência detectada — dia da semana sozinho, sem
    // sinal de recorrência genuína (ex: menção editorial de dia), ou
    // nenhum dia mencionado. Item devolvido sem alteração.
    return {
      item,
      recurrence: {
        recurrence_type: null,
        recurrence_days: null,
        recurrence_time: null,
        review_reasons: [],
      },
    };
  }

  const rangeCount = countTimeRanges(candidateText);
  const reviewReasons: RecurrenceReviewReason[] = [];
  let recurrenceTime: string | null = null;

  if (rangeCount === 1) {
    // Um único intervalo, partilhado por todos os dias detectados
    // (Casos B/C). Reutiliza parseTimeRangePt — não duplica parsing.
    const { time } = parseTimeRangePt(candidateText);
    recurrenceTime = time;
    // O intervalo tem sempre fim quando rangeCount===1 (o padrão de
    // contagem exige "Xh às Yh") — o fim nunca é persistido nesta
    // camada (só recurrence_time existe), mas nunca é perdido: fica
    // recuperável, verbatim, em recurrence_text_hint.
    reviewReasons.push('recurrence_end_time_not_persisted');
  } else if (rangeCount >= 2) {
    // Horários diferentes por dia (Caso D) — o contrato actual não
    // consegue representar isto fielmente com um único recurrence_time.
    // NUNCA escolher um dos horários arbitrariamente.
    recurrenceTime = null;
    reviewReasons.push('recurrence_per_day_times_not_representable');
  }
  // rangeCount === 0: recorrência sem horário publicado (Caso A) —
  // recurrenceTime permanece null, sem review_reasons.

  // Hint verbatim — o campo INTEIRO (title ou description) onde a
  // recorrência foi encontrada, nunca uma reconstrução/interpretação.
  // description prioritizado sobre title: nos padrões reais observados
  // (staging.raw_activity_items, prefeitura_iguaba_grande), a frase de
  // horário vive tipicamente numa descrição/sub-bloco, não no título.
  const description = item.description ?? '';
  const textHint = description && detectWeekdays(description).length > 0 ? description : item.title;

  const updatedItem: RawActivityItem = item.recurrence_text_hint === textHint
    ? item
    : { ...item, recurrence_text_hint: textHint };

  return {
    item: updatedItem,
    recurrence: {
      recurrence_type: 'weekly',
      recurrence_days: days,
      recurrence_time: recurrenceTime,
      review_reasons: reviewReasons,
    },
  };
}

/** Aplica detectRecurrence a uma lista de items. Função pura, sem I/O. */
export function detectRecurrenceItems(items: readonly RawActivityItem[]): RecurrenceDetectedItem[] {
  return items.map(detectRecurrence);
}
