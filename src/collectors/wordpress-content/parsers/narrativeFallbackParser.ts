import { parseTimeRangePt, stripHtmlToText } from './sharedTextUtils';
import { scanDateMentionsPt, distinctDates, referenceInstant, type DateMention, type PublicationReference } from './datePt';
import { hasQualifyingRecurrenceEvidence } from '../../../pipeline/stages/02-recurrence-detection';

/**
 * Parser narrativo — camada 2 (fallback) do extrator de duas camadas.
 *
 * Só é chamado quando structuredBlockParser não encontra o marcador
 * estruturado no post. NUNCA substitui um resultado válido da camada 1
 * — essa garantia é responsabilidade de quem orquestra as duas
 * camadas (mapToRawActivityItems), não deste módulo isoladamente,
 * mas o design daqui assume e reforça essa premissa: esta função
 * não tem nenhum mecanismo de "desempate" com a camada 1 porque ela
 * nunca deveria rodar quando a camada 1 já teve sucesso.
 *
 * Princípio central, diferente da camada 1: AMBIGUIDADE NUNCA É
 * RESOLVIDA POR INFERÊNCIA. Quando há mais de um sinal de data
 * candidato, ou um sinal de horário que não se liga com confiança a
 * uma data específica, o resultado é `ambiguous`, não uma tentativa
 * de adivinhar qual combinação é a correta. Prefere perder o evento
 * (deixá-lo para revisão humana) a inventar uma associação data+hora
 * que pode estar errada.
 *
 * Confiança desta camada é sempre estruturalmente menor que a da
 * camada 1 — o valor mais alto possível aqui (CONFIDENCE_SINGLE_CLEAR)
 * é definido abaixo de qualquer confiança típica de um sub-evento
 * bem formado da camada 1.
 *
 * Activity 13/26, F6, 2026-09-28 — Pure Recurrence Narrative Discovery
 * Gap. Confirmado por evidência real (fonte oficial São Pedro da
 * Aldeia): uma série recorrente genuína ("Toda sexta-feira... das 10h
 * às 15h") nunca produzia nenhum RawActivityItem, porque este parser
 * sempre exigia pelo menos uma data candidata antes de aceitar
 * qualquer texto — mesmo quando a recorrência em si era clara e
 * detectável. Isto criava uma assimetria real face ao contrato de
 * Publishing (Activity 9/26), que já suporta explicitamente
 * activities recurrence-only (occurrences=[] + recorrência
 * estruturada válida).
 *
 * Extensão aprovada (Level 3): quando NENHUMA data candidata é
 * encontrada, mas o texto passa no gate de qualificação forte e
 * determinístico já usado por detectRecurrence.ts — reutilizado aqui
 * via hasQualifyingRecurrenceEvidence(), nunca reimplementado — o
 * resultado passa a ser `recurrence_only` em vez de `not_found`,
 * permitindo que mapToRawActivityItems.ts crie um RawActivityItem com
 * occurrences=[]. A regra de "o que conta como recorrência" continua
 * a existir num único lugar (02-recurrence-detection) — este módulo
 * nunca decide recurrence_type/days/time, só se deve ou não criar um
 * item quando não há data concreta.
 */

export const NARRATIVE_CONFIDENCE = {
  SINGLE_CLEAR: 0.55,    // exatamente 1 data candidata + exatamente 1 horário candidato
  DATE_ONLY: 0.35,        // data clara, mas nenhum horário encontrado
  // Activity 13/26, F6 — confiança do caminho recurrence-only. Abaixo
  // de DATE_ONLY porque não há nenhuma data concreta corroborando —
  // só o sinal textual de recorrência, mais fraco como evidência
  // isolada do que uma data explícita.
  RECURRENCE_ONLY: 0.3,
} as const;

// Activity 13/26, F6 — novo valor de status, aditivo. Os três valores
// existentes (extracted/ambiguous/not_found) mantêm exactamente o
// mesmo significado e as mesmas condições de antes.
export type NarrativeParseStatus = 'extracted' | 'ambiguous' | 'not_found' | 'recurrence_only';

export type NarrativeReviewReason = 'venue_not_extracted_from_narrative';

export interface NarrativeCandidateDate {
  date: string;
  matchedText: string;   // o trecho exato do texto que originou esta data — auditoria
}

export interface NarrativeParseResult {
  status: NarrativeParseStatus;
  date: string | null;
  endDate: string | null;          // data final quando a única data candidata é um intervalo explícito ("de 10 a 12 de outubro")
  time: string | null;
  endTime: string | null;
  venueName: string | null;
  confidence: number | null;       // null quando status !== 'extracted' e status !== 'recurrence_only'
  ambiguityReason: string | null;  // populado quando status === 'ambiguous', para auditoria/painel de revisão
  reviewReasons: NarrativeReviewReason[];  // sinais de extração PARCIAL, mesmo quando status === 'extracted'/'recurrence_only'
  candidateDates: NarrativeCandidateDate[];  // TODAS as datas candidatas encontradas, mesmo quando ambíguo
  rawText: string;  // texto original (já sem HTML) preservado para auditoria, conforme decisão do usuário
}

export type NarrativeReference = PublicationReference;

const DAY_MS = 24 * 60 * 60 * 1000;

interface CandidateScan {
  candidates: NarrativeCandidateDate[];
  /** endDate de cada candidato (mesmo índice), para intervalos explícitos. */
  endDates: Array<string | null>;
  inconsistencies: string[];
}

/**
 * Encontra todas as datas candidatas no texto (scanDateMentionsPt):
 * datas por extenso com ou sem ano ("28 de junho de 2026", "8 de
 * novembro"), intervalos, listas, "dd/mm/aaaa" e dia + dia da semana
 * ("sexta-feira (19)", "quinta-feira, dia 22"). Datas repetidas contam
 * uma vez.
 *
 * Regra conservadora da camada narrativa (prosa de notícia, não um
 * bloco de agenda): uma data cujo ANO ou MÊS foi INFERIDO só é candidata
 * se for ESTRITAMENTE POSTERIOR ao dia de publicação (data UTC do
 * date_gmt). Datas anteriores ou do próprio dia, em notícias, são quase
 * sempre relatos do que já aconteceu ("na última quarta-feira, dia 16",
 * "iniciou nesta terça-feira, dia 22, o pagamento", "Lei publicada em 18
 * de setembro") — ficar sem data é preferível a anunciar como evento algo
 * que já passou. Custo assumido: um anúncio "hoje (19)" publicado no
 * próprio dia perde a data. Sem instante de publicação (só ano/mês), o
 * limite é o dia 1 do mês, inclusive. Datas com ano explícito mantêm o
 * comportamento anterior quanto a esta regra (são sempre candidatas).
 *
 * Em qualquer forma, uma menção de LIMITE ("até o dia 8 de novembro",
 * "até a próxima segunda-feira (12)", "até 29 de janeiro de 2027") não é
 * candidata: é um prazo de inscrição ou o fim de uma exposição, não o
 * dia de uma ocorrência.
 */
function findAllCandidateDates(text: string, reference: Date, hasInstant: boolean): CandidateScan {
  const scan = scanDateMentionsPt(text, reference);
  const minExclusiveIso = new Date(reference.getTime() - (hasInstant ? 0 : DAY_MS)).toISOString().slice(0, 10);
  // Prazos/limites ("até o dia 8 de novembro") nunca são o dia de uma ocorrência.
  const kept: DateMention[] = scan.mentions.filter((m) => !m.until && (m.kind === 'full' || m.date > minExclusiveIso));

  const candidates: NarrativeCandidateDate[] = [];
  const endDates: Array<string | null> = [];
  for (const d of distinctDates(kept)) {
    const first = kept.find((m) => m.date === d.date && m.endDate === d.endDate)!;
    candidates.push({ date: d.date, matchedText: first.matchedText });
    endDates.push(d.endDate);
  }
  return {
    candidates,
    endDates,
    inconsistencies: scan.inconsistencies.map((i) => `${i.reason}: "${i.matchedText}"`),
  };
}

/**
 * Tenta extrair um nome de venue de frases comuns no texto narrativo,
 * como "em Vila Nova", "no Centro Cultural", "na Praça da Matriz". Esta
 * extração é deliberadamente modesta — só captura padrões muito
 * comuns e específicos; texto que não casar fica com venueName null,
 * nunca um palpite.
 */
function extractVenueNameNarrative(text: string): string | null {
  const match = text.match(/\b(?:n[ao]|em)\s+([A-ZÀ-Ü][\wá-úÀ-Ü\s]{2,40}?)(?:[,.\n]|\s+(?:em|neste|nesta)\b|$)/);
  return match ? match[1].trim() : null;
}

export function parseNarrativeFallback(
  htmlContent: string,
  postPublishedAt: NarrativeReference,
): NarrativeParseResult {
  const text = stripHtmlToText(htmlContent);

  const hasInstant = postPublishedAt.referenceDate !== undefined && !Number.isNaN(postPublishedAt.referenceDate.getTime());
  const scan = findAllCandidateDates(text, referenceInstant(postPublishedAt), hasInstant);
  const candidateDates = scan.candidates;

  // Texto com uma data cujo dia da semana não bate com o calendário
  // ("quarta-feira (20)" quando o dia 20 é uma terça) ou com uma data
  // de calendário impossível: a própria fonte é inconsistente, por isso
  // nenhuma data é escolhida (nem a recorrência é assumida) — vai para
  // revisão humana com o motivo explícito (ADR-0003).
  if (scan.inconsistencies.length > 0) {
    return {
      status: 'ambiguous',
      date: null,
      endDate: null,
      time: null,
      endTime: null,
      venueName: extractVenueNameNarrative(text),
      confidence: null,
      ambiguityReason: `data inconsistente no texto (${scan.inconsistencies.join('; ')})`,
      reviewReasons: [],
      candidateDates,
      rawText: text,
    };
  }

  if (candidateDates.length === 0) {
    // Activity 13/26, F6 — antes de desistir (not_found), verificar se
    // há evidência forte e determinística de recorrência genuína.
    // Reutiliza a MESMA lógica já testada em detectRecurrence.ts —
    // nunca reimplementada aqui. Este ramo nunca calcula
    // recurrence_type/days/time — só decide se um RawActivityItem
    // deve existir mesmo sem data concreta.
    if (hasQualifyingRecurrenceEvidence(text)) {
      const venueName = extractVenueNameNarrative(text);
      const reviewReasons: NarrativeReviewReason[] = [];
      if (!venueName) reviewReasons.push('venue_not_extracted_from_narrative');

      return {
        status: 'recurrence_only',
        date: null,
        endDate: null,
        time: null,
        endTime: null,
        venueName,
        confidence: NARRATIVE_CONFIDENCE.RECURRENCE_ONLY,
        ambiguityReason: null,
        reviewReasons,
        candidateDates: [],
        rawText: text,
      };
    }

    return {
      status: 'not_found',
      date: null,
      endDate: null,
      time: null,
      endTime: null,
      venueName: null,
      confidence: null,
      ambiguityReason: null,
      reviewReasons: [],
      candidateDates: [],
      rawText: text,
    };
  }

  const { time, endTime } = parseTimeRangePt(text);
  const venueName = extractVenueNameNarrative(text);

  // Mais de uma data candidata: NÃO tenta decidir qual é a "principal"
  // nem gera múltiplos itens (isso é responsabilidade exclusiva da
  // camada 1, com seus delimitadores estruturais explícitos). Aqui,
  // múltiplas datas sem estrutura clara de associação a horários
  // específicos é o caso clássico de ambiguidade que deve ir para
  // revisão humana, não ser resolvido por adivinhação.
  if (candidateDates.length > 1) {
    return {
      status: 'ambiguous',
      date: null,
      endDate: null,
      time: null,
      endTime: null,
      venueName,
      confidence: null,
      ambiguityReason: `múltiplas datas candidatas encontradas (${candidateDates.length}) sem estrutura clara de associação a horário/evento individual`,
      reviewReasons: [],
      candidateDates,
      rawText: text,
    };
  }

  const singleDate = candidateDates[0].date;
  const singleEndDate = scan.endDates[0] ?? null;

  // Uma data, mas múltiplos horários candidatos diferentes no texto
  // (raro, mas possível em narrativas que mencionam vários horários
  // de referência) — também ambíguo, mesma régua. Importante: dispara
  // mesmo quando parseTimeRangePt conseguiu capturar UM dos horários
  // com sucesso — múltiplos horários distintos no texto é ambíguo por
  // si só, independente de a regex simples ter "escolhido" um deles
  // como o capturado; não usamos esse acaso como sinal de confiança.
  const allTimeMatches = [...text.matchAll(/\d{1,2}h\d{0,2}/gi)];
  const distinctTimes = new Set(allTimeMatches.map((m) => m[0].toLowerCase()));
  if (distinctTimes.size > 1) {
    return {
      status: 'ambiguous',
      date: singleDate,
      endDate: null,
      time: null,
      endTime: null,
      venueName,
      confidence: null,
      ambiguityReason: `múltiplos horários mencionados no texto (${[...distinctTimes].join(', ')}) sem associação clara a um único evento`,
      reviewReasons: [],
      candidateDates,
      rawText: text,
    };
  }

  // Caminho limpo: exatamente 1 data, e ou exatamente 1 horário claro
  // ou nenhum horário (aceitável — uma atividade sem horário ainda é
  // um evento válido, só com confiança mais baixa).
  //
  // Mesmo aqui, no caminho de sucesso, a AUSÊNCIA de venue não é
  // tratada como erro fatal nem como motivo para descartar a data/hora
  // já extraídas com confiança — mas é sinalizada explicitamente via
  // reviewReasons, para que o painel de revisão saiba que este campo
  // específico precisa de atenção humana, sem perder o restante do
  // que já foi extraído corretamente. Decisão explícita: não ampliar
  // a heurística de venue para evitar capturar sujeitos de frase
  // incorretamente como se fossem locais.
  const reviewReasons: NarrativeReviewReason[] = [];
  if (!venueName) {
    reviewReasons.push('venue_not_extracted_from_narrative');
  }

  return {
    status: 'extracted',
    date: singleDate,
    endDate: singleEndDate,
    time,
    endTime,
    venueName,
    confidence: time ? NARRATIVE_CONFIDENCE.SINGLE_CLEAR : NARRATIVE_CONFIDENCE.DATE_ONLY,
    ambiguityReason: null,
    reviewReasons,
    candidateDates,
    rawText: text,
  };
}
