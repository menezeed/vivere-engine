import {
  parseExplicitDatePt,
  parseTimeRangePt,
  combineDayWithReference,
  extractParentheticalDayNumber,
  stripHtmlToText,
} from './sharedTextUtils';

/**
 * Parser de bloco estruturado — camada 1 (alta confiança) do extrator
 * de duas camadas do WordPressContentCollector. Procura um marcador
 * de bloco configurável por instância (ex: "SERVIÇO:", "PROGRAMAÇÃO:",
 * "AGENDA:", "INFORMAÇÕES:" — varia entre prefeituras/organizações
 * reais) e extrai sub-blocos rotulados (Dia/Data/Horário/Local, esses
 * sim fixos no motor — vocabulário comum de agenda em português) que
 * vêm depois do marcador.
 *
 * Decisão de design confirmada: 1 post pode gerar N eventos quando o
 * bloco estruturado contém múltiplos sub-blocos (caso real observado:
 * "Arraiá da Praça da Bandeira" + "Arraiá do Peró" no mesmo post).
 * Cada sub-bloco é delimitado por uma tag <strong> que NÃO é,
 * sozinha, um dos rótulos conhecidos (Dia:, Horário:, Local:) — essa
 * linha é o título do sub-evento.
 *
 * Esta função NUNCA infere recorrência a partir de texto vago — ela
 * só extrai o que está explícito (data literal, horário literal).
 * Sinais de recorrência textual ficam para o módulo de inferência de
 * recorrência do pipeline central, não para o Collector.
 */

export type StructuredBlockReviewReason = 'schedule_grouping_detected';

export interface StructuredSubEvent {
  title: string;
  date: string | null;
  time: string | null;
  endTime: string | null;
  venueName: string | null;
  rawBlockText: string;   // texto bruto do sub-bloco, para auditoria
  reviewReason: StructuredBlockReviewReason | null;
}

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado'];
const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * Detecta títulos que são apenas MARCADORES DE AGRUPAMENTO TEMPORAL
 * (dia da semana, data numérica solta, nome de mês isolado), sem
 * nenhuma palavra adicional que indique o nome real de um evento.
 *
 * Caso real que motivou esta função: um post estruturava sua
 * programação como "Sexta (5) – Banda X", "Sábado (6) – Banda Y" —
 * cada dia em negrito, sem nome de evento, com a atração musical
 * vindo depois do separador. O parser de sub-bloco compacto (que
 * espera "Título – Local – Hora") interpreta a atração como se
 * fosse o venue, o que é semanticamente errado.
 *
 * Em vez de tentar reconstruir esse 4º formato automaticamente
 * (decisão explícita do usuário: não comprometer a confiabilidade
 * da camada atual com mais regras especiais), esta função apenas
 * RECONHECE o padrão e sinaliza para revisão humana — generalizada
 * para cobrir variações futuras (outras prefeituras podem usar
 * "05/06", "Junho" isolado, etc.) sem precisar de uma nova regra
 * literal a cada formato novo encontrado.
 */
function isOnlyTemporalGroupingMarker(title: string): boolean {
  const normalized = title.trim().toLowerCase();

  // Dia da semana + número entre parênteses, e nada mais
  // (ex: "Sexta (5)", "Domingo (7)")
  const weekdayPattern = WEEKDAY_NAMES.join('|');
  if (new RegExp(`^(?:${weekdayPattern})[a-zçã-]*\\s*\\(\\d{1,2}\\)$`, 'i').test(normalized)) {
    return true;
  }

  // Data numérica solta, sem mais nenhuma palavra (ex: "05/06", "5/6")
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(normalized)) {
    return true;
  }

  // Nome de mês isolado, sem mais nenhuma palavra (ex: "Junho")
  if (MONTH_NAMES.includes(normalized)) {
    return true;
  }

  // Dia da semana isolado, sem parênteses nem mais nada (ex: "Sexta-feira")
  if (new RegExp(`^(?:${weekdayPattern})([a-zçã-]*feira)?$`, 'i').test(normalized)) {
    return true;
  }

  return false;
}

export interface StructuredBlockParseResult {
  found: boolean;
  subEvents: StructuredSubEvent[];
}

// LABEL_LINE_PATTERN permanece FIXO no motor — vocabulário comum de
// agenda em português (Dia/Data/Horário/Local), decisão explícita do
// usuário de não promover isso a configuração nesta fase. Só o
// marcador de bloco (SERVIÇO:/PROGRAMAÇÃO:/AGENDA:/INFORMAÇÕES:) é
// configurável por instância, recebido como parâmetro em parseStructuredBlock.
const LABEL_LINE_PATTERN = /^(dia|data|hor[áa]rio|local)\s*:/i;

/**
 * Divide o HTML do bloco SERVIÇO em sub-blocos usando <strong> como
 * delimitador real — cada ocorrência de uma tag <strong> dentro do
 * bloco SERVIÇO marca o início de um novo sub-evento, independente
 * de haver rótulos (Dia:/Horário:/Local:) ou não.
 *
 * Esta decisão foi tomada depois de observar dois formatos reais
 * distintos na mesma fonte:
 *   - Formato rotulado (ex: "Yoga no Forte"): <strong>Título</strong>
 *     seguido de linhas com Dia:/Horário:/Local: explícitos.
 *   - Formato compacto (ex: "Arraiás"): <strong>Título – Local – Hora</strong>
 *     seguido de uma linha solta com os dias, sem nenhum rótulo.
 *
 * Delimitar por <strong> funciona para ambos, porque os dois formatos
 * têm em comum o uso de negrito para marcar o início de cada evento
 * — é o único sinal estrutural confiável presente nos dois casos.
 *
 * IMPORTANTE: isto precisa operar sobre o HTML bruto, antes de
 * stripHtmlToText remover as tags — depois da conversão para texto
 * puro não há mais como saber onde estava o <strong>.
 */
/**
 * Verifica se o texto dentro de um <strong> é EXATAMENTE um rótulo
 * conhecido (Local:, Dia:, Data:, Horário:), com ou sem os dois
 * pontos. Usado para distinguir um <strong> que marca um TÍTULO de
 * sub-evento de um <strong> que o autor usou apenas para destacar
 * visualmente um rótulo — caso real observado em posts onde tanto o
 * título do evento quanto os rótulos "Local:"/"Horário:" estão em
 * negrito, o que sem esta checagem gerava sub-eventos falsos vazios
 * (ex: um "evento" chamado apenas "Local:", sem data nem venue).
 */
function isPureLabelText(strongInnerText: string): boolean {
  const normalized = strongInnerText.trim().replace(/:$/, '').trim().toLowerCase();
  return ['local', 'dia', 'data', 'horário', 'horario'].includes(normalized);
}

/**
 * Detecta sub-eventos cujo título é apenas um RÓTULO INFORMATIVO
 * GENÉRICO (ex: "Mediação dos cursos:", "Informações:",
 * "Observações:", "Realização:", "Coordenação:", "Contato:",
 * "Inscrições:") — texto que faz parte da publicação mas não
 * representa um evento em si.
 *
 * Diferente de isPureLabelText (lista fechada de rótulos de AGENDA
 * — Local/Dia/Data/Horário — que carregam dado relevante e por isso
 * são FUNDIDOS ao sub-evento anterior), esta função é estrutural,
 * não uma lista de palavras: identifica o PADRÃO sintático de rótulo
 * (curto, termina em ":", sem mais nenhum conteúdo) para generalizar
 * a qualquer rótulo informativo futuro, sem precisar enumerar cada
 * palavra individualmente. Usada apenas no filtro final de descarte,
 * nunca na fusão — um rótulo informativo não carrega dado de agenda
 * para "salvar" fundindo com o evento anterior, então o sub-evento
 * inteiro (se não tiver nenhuma data/hora/venue) é descartado.
 *
 * Regra estrutural: título termina em ":", tem no máximo 4 palavras
 * antes dos dois-pontos, e nenhuma palavra é um número (o que
 * descartaria por engano algo como "Sexta (5):", que tem outro
 * tratamento via isOnlyTemporalGroupingMarker).
 */
function isGenericInformationalLabel(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed.endsWith(':')) return false;

  const withoutColon = trimmed.slice(0, -1).trim();
  if (withoutColon.length === 0) return false;

  const words = withoutColon.split(/\s+/);
  if (words.length > 4) return false; // título de evento real tende a ser mais longo

  if (/\d/.test(withoutColon)) return false; // evita capturar marcadores temporais como "Dia 5:"

  return true;
}

function splitStructuredHtmlIntoSubBlocks(servicoHtml: string): string[] {
  // Divide a string nas posições de abertura de <strong>, mantendo o
  // conteúdo de cada sub-bloco a partir daquele ponto até o próximo.
  const rawParts = servicoHtml.split(/(?=<strong>)/i).filter((p) => p.trim().length > 0);

  // Funde qualquer parte cujo <strong> seja um rótulo puro (Local:,
  // Dia:, Horário:, Data:) com a parte ANTERIOR — isso é o autor
  // destacando visualmente um rótulo dentro do mesmo sub-evento, não
  // o início de um sub-evento novo. Sem essa fusão, cada rótulo em
  // negrito geraria seu próprio "sub-evento" vazio.
  const merged: string[] = [];
  for (const part of rawParts) {
    const strongMatch = part.match(/<strong>(.*?)<\/strong>/i);
    const isLabelOnly = strongMatch ? isPureLabelText(stripHtmlToText(strongMatch[1])) : false;

    if (isLabelOnly && merged.length > 0) {
      merged[merged.length - 1] += part;
    } else {
      merged.push(part);
    }
  }

  // A primeira parte, antes do primeiro <strong> real de título, é só
  // texto introdutório/lixo entre o marcador "SERVIÇO:" e o primeiro
  // sub-evento — descartada se não contiver ela própria um <strong>.
  return merged.filter((p) => /<strong>/i.test(p));
}

function parseSubBlock(blockHtml: string): StructuredSubEvent {
  const text = stripHtmlToText(blockHtml);
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  // O título é especificamente o conteúdo que estava dentro da
  // primeira tag <strong> deste sub-bloco — extraído do HTML, não
  // da primeira linha de texto.
  const strongMatch = blockHtml.match(/<strong>(.*?)<\/strong>/i);
  const title = strongMatch ? stripHtmlToText(strongMatch[1]).trim() : (lines[0] ?? '').trim();

  const dayLine = lines.find((l) => /^(dia|data)\s*:/i.test(l));
  const timeLine = lines.find((l) => /^hor[áa]rio\s*:/i.test(l));
  const localLine = lines.find((l) => /^local\s*:/i.test(l));

  // Caminho rotulado (formato "Yoga no Forte")
  let date = dayLine ? parseExplicitDatePt(dayLine) : null;
  let { time, endTime } = timeLine ? parseTimeRangePt(timeLine) : { time: null, endTime: null };
  let venueName = localLine ? localLine.replace(/^local\s*:\s*/i, '').trim() || null : null;

  // Caminho compacto (formato "Arraiá"): local e hora vêm em texto
  // solto imediatamente após o </strong> de fechamento, separados
  // por "–"/"-", ex: "Arraiá da Praça da Bandeira – Passagem – 16h".
  // Esse texto NÃO está dentro da tag <strong> (só o título está) —
  // por isso é extraído da primeira LINHA completa do sub-bloco, que
  // inclui tanto o título quanto esse complemento solto.
  if (!venueName || !time) {
    const firstLine = lines[0] ?? '';
    const firstLineParts = firstLine.split(/\s[–-]\s/).map((p) => p.trim());

    if (!venueName && firstLineParts.length >= 2) {
      // a primeira parte é o título (já capturado acima); a segunda,
      // quando não é claramente um horário, é o nome do local
      const candidate = firstLineParts[1];
      if (candidate && !parseTimeRangePt(candidate).time) {
        venueName = candidate || null;
      }
    }
    if (!time && firstLineParts.length >= 2) {
      // a hora pode estar na 2ª ou 3ª parte, dependendo de haver
      // local explícito ou não
      for (const part of firstLineParts.slice(1)) {
        const range = parseTimeRangePt(part);
        if (range.time) {
          time = range.time;
          endTime = range.endTime;
          break;
        }
      }
    }
  }

  return {
    title,
    date,
    time,
    endTime,
    venueName,
    rawBlockText: text,
    reviewReason: isOnlyTemporalGroupingMarker(title) ? 'schedule_grouping_detected' : null,
  };
}

/**
 * Função principal. Recebe o HTML bruto do post (content.rendered da
 * WordPress REST API), a data de publicação (usada apenas como
 * referência de ano/mês se algum sub-bloco usar dia numérico isolado),
 * e o marcador de bloco estruturado configurado para esta instância
 * da fonte (ex: /servi[çc]o:?/i para Cabo Frio, /programa[çc][ãa]o:?/i
 * para outra prefeitura que use vocabulário diferente).
 */
export function parseStructuredBlock(
  htmlContent: string,
  postPublishedAt: { year: number; month: number },
  structuredBlockMarker: RegExp,
): StructuredBlockParseResult {
  const markerMatch = htmlContent.match(structuredBlockMarker);

  if (!markerMatch) {
    return { found: false, subEvents: [] };
  }

  const afterMarkerHtml = htmlContent.slice(markerMatch.index! + markerMatch[0].length);
  const subBlocksHtml = splitStructuredHtmlIntoSubBlocks(afterMarkerHtml);

  const subEvents = subBlocksHtml
    .map(parseSubBlock)
    .filter((ev) => ev.title.length > 0)
    // Defesa adicional: mesmo após a fusão de rótulos em
    // splitStructuredHtmlIntoSubBlocks, um sub-evento cujo título
    // extraído é, ele próprio, apenas um rótulo puro (ex: documento
    // real malformado, ou bloco que começa direto com "Local:" sem
    // título de evento antes) é descartado em vez de virar um
    // "evento" sem sentido nenhum chamado "Local:" — preferir perder
    // a inventar, mesma régua já aplicada na camada 2.
    .filter((ev) => !isPureLabelText(ev.title))
    // Descarta sub-eventos cujo título é um rótulo informativo
    // genérico (Mediação dos cursos:, Informações:, Contato:, etc.)
    // E que não carregam nenhum dado de agenda — só descarta quando
    // o sub-evento está genuinamente vazio de informação útil;
    // se por algum motivo um sub-evento com esse padrão de título
    // tiver data/horário/venue capturado, ele é preservado, porque
    // claramente carrega informação real apesar do título atípico.
    .filter((ev) => {
      const isGenericLabel = isGenericInformationalLabel(ev.title);
      const hasNoAgendaData = !ev.date && !ev.time && !ev.venueName;
      return !(isGenericLabel && hasNoAgendaData);
    });

  // Fallback de data: se um sub-evento não tem data explícita mas o
  // bloco contém um dia entre parênteses (ex: "sexta (26)"), usa a
  // data de publicação do post como referência de ano/mês — NUNCA
  // adivinha o mês a partir do nada.
  for (const ev of subEvents) {
    if (!ev.date) {
      const dayNumber = extractParentheticalDayNumber(ev.rawBlockText) ?? extractParentheticalDayNumber(ev.title);
      if (dayNumber !== null) {
        ev.date = combineDayWithReference(dayNumber, postPublishedAt.year, postPublishedAt.month);
      }
    }
  }

  return { found: true, subEvents };
}
