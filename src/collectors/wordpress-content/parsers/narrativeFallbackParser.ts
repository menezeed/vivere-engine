import { parseExplicitDatePt, parseTimeRangePt, combineDayWithReference, extractParentheticalDayNumber, stripHtmlToText } from './sharedTextUtils';

/**
 * Parser narrativo — camada 2 (fallback) do extrator de duas camadas.
 *
 * Só é chamado quando servicoBlockParser não encontra o marcador
 * "SERVIÇO:" no post. NUNCA substitui um resultado válido da camada 1
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
 */

export const NARRATIVE_CONFIDENCE = {
  SINGLE_CLEAR: 0.55,    // exatamente 1 data candidata + exatamente 1 horário candidato
  DATE_ONLY: 0.35,        // data clara, mas nenhum horário encontrado
} as const;

export type NarrativeParseStatus = 'extracted' | 'ambiguous' | 'not_found';

export type NarrativeReviewReason = 'venue_not_extracted_from_narrative';

export interface NarrativeCandidateDate {
  date: string;
  matchedText: string;   // o trecho exato do texto que originou esta data — auditoria
}

export interface NarrativeParseResult {
  status: NarrativeParseStatus;
  date: string | null;
  time: string | null;
  endTime: string | null;
  venueName: string | null;
  confidence: number | null;       // null quando status !== 'extracted'
  ambiguityReason: string | null;  // populado quando status === 'ambiguous', para auditoria/painel de revisão
  reviewReasons: NarrativeReviewReason[];  // sinais de extração PARCIAL, mesmo quando status === 'extracted'
  candidateDates: NarrativeCandidateDate[];  // TODAS as datas candidatas encontradas, mesmo quando ambíguo
  rawText: string;  // texto original (já sem HTML) preservado para auditoria, conforme decisão do usuário
}

/**
 * Encontra todas as datas candidatas no texto: tanto datas explícitas
 * ("28 de junho de 2026") quanto dias entre parênteses associados a
 * nome de dia da semana ("sexta-feira (19)"), estas últimas combinadas
 * com a referência de publicação do post.
 */
function findAllCandidateDates(
  text: string,
  postPublishedAt: { year: number; month: number },
): NarrativeCandidateDate[] {
  const candidates: NarrativeCandidateDate[] = [];

  const explicitMatches = text.matchAll(/\d{1,2}\s+de\s+[a-zçãâéê]+\s+de\s+\d{4}/gi);
  for (const m of explicitMatches) {
    const date = parseExplicitDatePt(m[0]);
    if (date) candidates.push({ date, matchedText: m[0] });
  }

  const weekdayPattern = ['domingo', 'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado'].join('|');
  const parentheticalMatches = text.matchAll(new RegExp(`(?:${weekdayPattern})[a-zçã-]*\\s*\\((\\d{1,2})\\)`, 'gi'));
  for (const m of parentheticalMatches) {
    const dayNumber = Number(m[1]);
    const date = combineDayWithReference(dayNumber, postPublishedAt.year, postPublishedAt.month);
    // Evita duplicar se a mesma data já foi capturada via formato explícito
    if (!candidates.some((c) => c.date === date)) {
      candidates.push({ date, matchedText: m[0] });
    }
  }

  return candidates;
}

/**
 * Tenta extrair um nome de venue de frases comuns no texto narrativo,
 * como "em Vila Nova", "no Centro Cultural", "na Praça da Matriz". Esta
 * extração é deliberadamente modesta — só captura padrões muito
 * comuns e específicos; texto que não casar fica com venueName null,
 * nunca um palpite.
 */
function extractVenueNameNarrative(text: string): string | null {
  const match = text.match(/\b(?:n[ao]|em)\s+([A-ZÀ-Ú][\wà-úÀ-Ú\s]{2,40}?)(?:[,.\n]|\s+(?:em|neste|nesta)\b|$)/);
  return match ? match[1].trim() : null;
}

export function parseNarrativeFallback(
  htmlContent: string,
  postPublishedAt: { year: number; month: number },
): NarrativeParseResult {
  const text = stripHtmlToText(htmlContent);

  const candidateDates = findAllCandidateDates(text, postPublishedAt);

  if (candidateDates.length === 0) {
    return {
      status: 'not_found',
      date: null,
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
