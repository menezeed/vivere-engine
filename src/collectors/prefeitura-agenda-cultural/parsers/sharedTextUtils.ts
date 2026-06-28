/**
 * Utilitários de extração de data/hora em texto livre em português.
 * Compartilhados entre servicoBlockParser e narrativeFallbackParser
 * para garantir que ambos interpretem o mesmo texto da mesma forma —
 * exatamente o mesmo princípio de reuso já aplicado em todo o VAIP
 * (ex: normalizeTitle reaproveitado entre dedupe e classificação de
 * categoria).
 *
 * Nenhuma função aqui INFERE recorrência — isso é proibido pelo
 * contrato. Estas funções só convertem texto explícito (uma data
 * literal, um horário literal) para o formato ISO. Texto vago
 * ("sempre no segundo sábado do mês") fica para recurrence_text_hint,
 * sem tentativa de parsing aqui.
 */

const MONTH_NAMES_PT: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04',
  maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09',
  outubro: '10', novembro: '11', dezembro: '12',
};

const WEEKDAY_NAMES_PT = [
  'domingo', 'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado',
];

/**
 * Converte "28 de junho de 2026" → "2026-06-28".
 * Retorna null se o texto não casar com o padrão esperado — nunca
 * tenta adivinhar um formato alternativo.
 */
export function parseExplicitDatePt(text: string): string | null {
  const match = text.match(/(\d{1,2})\s+de\s+([a-zçãâéê]+)\s+de\s+(\d{4})/i);
  if (!match) return null;

  const day = match[1].padStart(2, '0');
  const monthName = match[2].toLowerCase();
  const month = MONTH_NAMES_PT[monthName];
  const year = match[3];

  if (!month) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Converte "(28)" dentro de um contexto com mês/ano já conhecido
 * (referenceYear, referenceMonth) → "YYYY-MM-DD". Usado para o padrão
 * "nesta sexta-feira (19)" onde só o dia numérico aparece explícito,
 * mas o post tem uma data de publicação (referência) próxima.
 *
 * IMPORTANTE: isto não infere o mês — exige que referenceMonth seja
 * fornecido explicitamente por quem chama (tipicamente a partir de
 * post.date), nunca adivinhado a partir do dia isolado.
 */
export function combineDayWithReference(
  dayNumber: number,
  referenceYear: number,
  referenceMonth: number,
): string {
  const day = String(dayNumber).padStart(2, '0');
  const month = String(referenceMonth).padStart(2, '0');
  return `${referenceYear}-${month}-${day}`;
}

/**
 * Converte "7h", "7h30", "19h30" → "07:00", "07:30", "19:30".
 * Retorna null se não houver horário reconhecível.
 */
export function parseTimePt(text: string): string | null {
  const match = text.match(/(\d{1,2})h(\d{2})?/i);
  if (!match) return null;

  const hour = match[1].padStart(2, '0');
  const minute = (match[2] ?? '00').padStart(2, '0');

  if (Number(hour) > 23 || Number(minute) > 59) return null;
  return `${hour}:${minute}`;
}

/**
 * Extrai um par (início, fim) de "das 7h às 8h" → { time: '07:00', endTime: '08:00' }.
 * Extrai só o início de "a partir das 16h" → { time: '16:00', endTime: null }.
 */
export function parseTimeRangePt(text: string): { time: string | null; endTime: string | null } {
  // Cobre tanto "das 7h às 8h" quanto "Horário: 7h às 8h" (sem "das" antes do primeiro horário)
  const rangeMatch = text.match(/(\d{1,2}h\d{0,2})\s+(?:às|as)\s+(\d{1,2}h\d{0,2})/i);
  if (rangeMatch) {
    return { time: parseTimePt(rangeMatch[1]), endTime: parseTimePt(rangeMatch[2]) };
  }

  const withPrepositionMatch = text.match(/(?:a partir d[ae]s?|às|as)\s+(\d{1,2}h\d{0,2})/i);
  if (withPrepositionMatch) {
    return { time: parseTimePt(withPrepositionMatch[1]), endTime: null };
  }

  // Último fallback: horário solto, sem preposição nenhuma antes —
  // usado no formato compacto "Título – Local – 16h", onde o
  // separador "–" já delimita o campo, então o sufixo "h" isolado
  // é suficiente como sinal confiável de horário (números soltos
  // sem "h", como anos ou endereços, nunca casam aqui).
  const bareMatch = text.match(/^(\d{1,2}h\d{0,2})$/i);
  if (bareMatch) {
    return { time: parseTimePt(bareMatch[1]), endTime: null };
  }

  return { time: null, endTime: null };
}

/**
 * Detecta referências de dia da semana relativo ao momento da
 * publicação, como "nesta sexta-feira (19)" ou "no sábado (20)".
 * Retorna o NÚMERO do dia extraído entre parênteses, quando presente
 * — não o nome do dia da semana em si, porque o número é o dado
 * confiável; o nome serve só como contexto legível para humanos.
 */
export function extractParentheticalDayNumber(text: string): number | null {
  const weekdayPattern = WEEKDAY_NAMES_PT.join('|');
  const match = text.match(new RegExp(`(?:${weekdayPattern})[a-z-]*\\s*\\((\\d{1,2})\\)`, 'i'));
  if (!match) return null;
  return Number(match[1]);
}

/**
 * Normaliza texto bruto extraído de HTML: remove tags, colapsa
 * espaços, decodifica entidades comuns. Usado antes de qualquer
 * tentativa de parsing de data/hora.
 */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8216;/g, '\u2018')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8220;/g, '\u201c')
    .replace(/&#8221;/g, '\u201d')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
