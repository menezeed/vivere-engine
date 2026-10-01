/**
 * src/pipeline/stages/02-recurrence-detection/detectRecurrence.ts
 *
 * Activity 8/26, 2026-09-26 — versão original.
 * Activity 10B, 2026-09-27 — Recurrence Discovery Hardening:
 *   Part 1: extracção de horário único ("às 17h"), sem intervalo.
 *   Part 2: guarda de segurança para semântica mensal-ordinal.
 *   Part 4 (input): candidateText passa a incluir, quando disponível
 *     e seguro, o contexto adicional que os Collectors preservam em
 *     raw_payload (raw_text de narrative_fallback; article_context_text
 *     de structured_block de evento único) — nunca dados já
 *     interpretados, só texto de fonte.
 *
 * Função pura: RawActivityItem → RecurrenceDetectionResult. Zero
 * acesso a banco, zero efeitos colaterais. Reutiliza parseTimeRangePt
 * (sharedTextUtils.ts, prefeitura-agenda-cultural) — não duplica
 * parsing de horário já existente.
 *
 * Só implementa detecção de recorrência SEMANAL (weekly) — os padrões
 * reais confirmados até agora (Activity 8/26, Activity 10) são todos
 * semanais. daily/biweekly/monthly já são valores válidos no
 * contrato, mas nenhuma fonte real observada exige a sua detecção —
 * implementá-los sem evidência seria "inventar suporte para gramática
 * que nenhuma fonte real exige". Ficam para quando houver evidência.
 *
 * Estratégia de distinção B/C vs D (Activity 8, confirmada por
 * execução real): conta quantas MENÇÕES DE HORÁRIO distintas existem
 * no texto — um intervalo completo ("Xh às Yh") ou um horário único
 * com preposição ("às Xh", "a partir das Xh") contam cada um como
 * UMA menção. Uma única menção aplica-se a todos os dias detectados.
 * Duas ou mais menções significa horários DIFERENTES por dia, que o
 * contrato actual (um recurrence_time único) não consegue representar
 * fielmente — recurrence_time fica NULL, sinalizado, nunca escolhido
 * arbitrariamente.
 *
 * Activity 10B — correcção Part 1: até aqui, só intervalos completos
 * eram contados como "menção de horário"; um horário único sem
 * intervalo ("às 17h") não disparava nenhum ramo de extracção, e
 * recurrence_time ficava NULL silenciosamente, SEM review_reason —
 * pior do que os casos já tratados, que pelo menos sinalizam a perda.
 * Corrigido: menções de horário agora incluem intervalos E horários
 * únicos, cada um contado uma vez (nunca duas, mascarando os
 * intervalos já capturados antes de procurar únicos).
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

// Activity 13/26, F10-B, 2026-09-29 — correcção de causa raiz. Nome do
// dia + 's' plural opcional + '-feira'/'feira' opcional (com 's'
// plural opcional). ANTES: "segunda", "terça", "quarta", "quinta",
// "sexta" casavam SOZINHAS, sem exigir "-feira" — mas estas cinco
// palavras são também ordinais comuns em português ("segunda
// apresentação", "quarta edição", "sexta edição"), completamente sem
// relação com dias da semana. Confirmado por evidência real: um
// artigo genuíno sobre um espectáculo de teatro mencionava "essa
// segunda apresentação" (a segunda vez que a peça é mostrada) — nunca
// "segunda-feira" — e isso produzia uma recorrência semanal falsa
// (weekly/[1,6]) a partir de um evento de sábado único.
//
// Corrigido: "domingo"/"sábado" continuam sem exigir sufixo (nunca
// levam "-feira" em português real, nunca são ordinais comuns); as
// restantes cinco EXIGEM agora o sufixo "-feira(s)" para contar como
// dia INEQUÍVOCO, sozinhas. Isto por si só quebrava um caso real já
// suportado desde a Activity 8 — "Quartas e sextas das 9h às 11h"
// (lista de dias abreviados, sem "-feira", mas claramente uma lista de
// horário, não um ordinal) — corrigido abaixo com
// ABBREVIATED_WEEKDAY_LIST, um segundo padrão, mais estrito, que só
// aceita a forma abreviada dentro de uma estrutura de lista
// imediatamente seguida de evidência de horário.
const DAY_PATTERN = /(?:(domingo|s[áa]bado)s?|(segunda|ter[çc]a|quarta|quinta|sexta)s?-?feiras?)/gi;

// Activity 13/26, F10-B, 2026-09-29 — segunda parte da correcção,
// REVISTA após regressão real confirmada por execução. A primeira
// tentativa (lista de dias + UM horário partilhado no final, ex:
// "Quartas e sextas das 9h às 11h") era demasiado estreita — quebrava
// o Caso D original da Activity 8 ("Terças das 14h às 16h15 e sextas
// das 9h às 11h", cada dia com o SEU PRÓPRIO horário, não partilhado)
// e o Caso C da Activity 10B ("terças, às 9h, e quintas, às 17h").
//
// Abordagem revista, por FRASE: divide o texto em frases (por
// pontuação de fim de frase); dentro de qualquer frase que contenha
// evidência de horário (intervalo OU horário único), aceita TODOS os
// dias abreviados presentes NESSA MESMA frase — cobre "lista + um
// horário partilhado" E "dia+horário, dia+horário" indiferentemente,
// sem exigir uma estrutura sintáctica específica. Um ordinal solto
// como "segunda edição" nunca está na mesma frase que uma evidência de
// horário relacionada (confirmado pelos textos reais desta sessão —
// Teatro Municipal: "segunda apresentação" está numa frase diferente
// de "às 19h"), por isso nunca qualifica.
const ABBREVIATED_WEEKDAY_STEM_ONLY = /domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado/gi;
const ABBREVIATED_LIST_TIME_EVIDENCE =
  /\d{1,2}h\d{0,2}\s+(?:às|as)\s+\d{1,2}h\d{0,2}|(?:a partir d[ae]s?|às|as)\s+\d{1,2}h\d{0,2}/i;

function extractAbbreviatedListDays(text: string): number[] {
  const days = new Set<number>();
  const clauses = text.split(/[.!?\n]+/);
  for (const clause of clauses) {
    if (!ABBREVIATED_LIST_TIME_EVIDENCE.test(clause)) continue;
    const stemPattern = new RegExp(ABBREVIATED_WEEKDAY_STEM_ONLY.source, ABBREVIATED_WEEKDAY_STEM_ONLY.flags);
    let stemMatch: RegExpExecArray | null;
    while ((stemMatch = stemPattern.exec(clause)) !== null) {
      // Activity 13/26, F10-B — refinamento após regressão real: não
      // basta a frase conter ALGUMA evidência de horário — exige-se
      // que exista evidência de horário DAQUI PARA A FRENTE, a partir
      // da posição exacta desta menção de dia, dentro da mesma frase.
      // Confirmado por evidência real necessário: "neste sábado
      // (03/10), às 19h, acontece a segunda apresentação" — "segunda"
      // vem DEPOIS do horário, nunca tem horário à frente — corrige o
      // falso positivo sem quebrar "Terças das 14h às 16h15 e sextas
      // das 9h às 11h" (cada dia sempre tem o seu horário à frente).
      const restOfClause = clause.slice(stemMatch.index);
      if (!ABBREVIATED_LIST_TIME_EVIDENCE.test(restOfClause)) continue;
      const num = WEEKDAY_TO_NUMBER[stemMatch[0].toLowerCase()];
      if (num !== undefined) days.add(num);
    }
  }
  return [...days];
}

// Intervalo completo — mesmo padrão usado internamente por
// parseTimeRangePt. Usado aqui para CONTAR e para MASCARAR antes de
// procurar horários únicos (evita contar o "às Yh" final de um
// intervalo como se fosse um horário único adicional).
const TIME_RANGE_PATTERN = /\d{1,2}h\d{0,2}\s+(?:às|as)\s+\d{1,2}h\d{0,2}/gi;

// Activity 10B, Part 1 — horário único com preposição, sem intervalo.
// Mesmo vocabulário de preposições já usado por parseTimeRangePt
// ("a partir d[ae]s?", "às"/"as") — não introduz gramática nova.
const SINGLE_TIME_PATTERN = /(?:a partir d[ae]s?|às|as)\s+\d{1,2}h\d{0,2}/gi;

// Activity 10B, Part 2 — semântica mensal com qualificador ordinal
// ("todo último domingo de cada mês", "na primeira terça-feira").
// Sem \b inicial deliberadamente: palavras começadas por vogal
// acentuada (ex. "último") não são reconhecidas como limite de
// palavra por \b em JavaScript (\w não inclui acentos) — confirmado
// por execução real durante esta Activity; o mesmo padrão sem \b já
// é a convenção usada por DAY_PATTERN neste ficheiro.
const ORDINAL_MONTH_PATTERN =
  /(primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|últim[oa]|ultim[oa]|pen[uú]ltim[oa])\s+(domingo|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[áa]bado)/i;

// Activity 13/26, F8, 2026-09-29 — correcção de causa raiz. O padrão
// original, /\btod[ao]s?\b/i, casava "todo/toda/todos/todas" como
// PALAVRA em qualquer lugar do texto — incluindo o seu uso comum como
// quantificador português ("todos os documentos", "toda a
// população"), sem nenhuma relação com recorrência. Confirmado por
// evidência real: um artigo administrativo (PNAB) contendo "Todos os
// documentos estão disponíveis" — frase comum, não relacionada — fez
// o guarda de "só menção datada" (abaixo) concluir, erradamente, que
// havia um sinal de recorrência independente, permitindo uma
// recorrência falsa a partir de uma menção de dia meramente datada.
//
// Corrigido para exigir associação estrutural: "todo/toda(s)" seguido,
// no máximo por UMA palavra intermédia (artigo "o/os/a/as", ou um
// adjectivo ordinal como "último"/"primeiro", conforme exigido pelos
// casos reais de mensal-ordinal — Activity 10B), por um nome de dia da
// semana — "toda sexta-feira", "todos os sábados", "todo último
// domingo". "todos os documentos"/"toda a população" nunca casam,
// porque a palavra final não é um dia da semana. Única semântica de
// sinal de recorrência "todo/toda" em todo o módulo — reutilizada por
// hasRecurrenceSignal() e hasOnlyDatedWeekdayMentions() (e, por
// extensão, por hasQualifyingRecurrenceEvidence(), Activity 13 F6).
const RECURRENCE_SIGNAL_PATTERN =
  /\btod[ao]s?\s+(?:\S+\s+)?(?:domingo|s[áa]bado)s?\b|\btod[ao]s?\s+(?:\S+\s+)?(?:segunda|ter[çc]a|quarta|quinta|sexta)s?-?feiras?/i;

// Activity 13/26, F10-B — mesma correcção de causa raiz aplicada aqui:
// "segunda"/"terça"/"quarta"/"quinta"/"sexta" são também ordinais
// comuns em português ("toda segunda apresentação", "toda quarta
// parte"), sem relação com dias da semana. Exigir "-feira" para estas
// cinco (domingo/sábado continuam sem sufixo, nunca ambíguos) fecha
// esse risco sem quebrar nenhum caso real ou testado nesta sessão —
// nenhuma evidência de "toda segunda" (sem -feira) como forma
// suportada foi encontrada no repositório.

// Activity 13/26, 2026-09-27 — F5, Fix 2. Dia da semana com data
// explícita entre parênteses ("sexta-feira (25/09)", "quarta-feira
// (17)") — mesma forma sintáctica já reconhecida por
// extractParentheticalDayNumber (sharedTextUtils.ts) para identificar
// uma REFERÊNCIA A DATA ÚNICA, nunca uma regra recorrente. Reutilizado
// aqui como sinal negativo: quando a ÚNICA evidência de dia no texto
// vem nesta forma, e não há nenhum sinal "todo/toda" independente,
// não é recorrência — é a mesma classe de falso positivo já protegida
// desde a Activity 8 (Caso H), agora estendida a um caso real onde um
// horário não relacionado, noutra frase, tornava esse dia elegível
// por engano.
// Activity 13/26, F9, 2026-09-29 — correcção de causa raiz. O sufixo
// "-feira" era exigido SEMPRE, para qualquer dia — mas "domingo" e
// "sábado" NUNCA levam "-feira" em português real ("domingo-feira"/
// "sábado-feira" não existem). Confirmado por evidência real: "neste
// sábado (03)" e "neste domingo (13)" nunca eram reconhecidos como
// menção DATADA por este guarda — eram tratados como menção de dia
// "nua", permitindo recorrência semanal falsa a partir de um evento
// de data única. Corrigido tornando "-feira(s)" inteiramente opcional
// para todos os dias, não só para segunda-a-sexta.
const DAY_WITH_PARENTHETICAL_DATE = /(?:domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)(?:-?feiras?)?\s*\(\d{1,2}(?:\/\d{1,2})?\)/gi;

// Activity 13/26, F10-A, 2026-09-29 — forma INVERSA real, confirmada
// por evidência: "02 de outubro (sexta-feira)", "20 de setembro
// (domingo)" — a data explícita vem primeiro, o dia da semana vem
// depois, entre parênteses, como esclarecimento. O padrão acima só
// reconhecia a ordem "dia-da-semana (número)" — esta ordem invertida
// nunca era reconhecida como "datada", permitindo recorrência falsa a
// partir de eventos de data única e explícita. Propósito idêntico ao
// padrão acima: nunca calcula recorrência, só marca o dia como já
// associado a uma data concreta.
const INVERSE_DATED_WEEKDAY = /\d{1,2}\s+de\s+[a-zà-ú]+\s*\((domingo|segunda-?feiras?|ter[çc]a-?feiras?|quarta-?feiras?|quinta-?feiras?|sexta-?feiras?|s[áa]bado)\)/gi;

function detectWeekdays(text: string): number[] {
  const days = new Set<number>();
  const pattern = new RegExp(DAY_PATTERN.source, DAY_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    // Activity 13/26, F10-B — dois grupos de captura agora: grupo 1
    // para domingo/sábado (sem sufixo), grupo 2 para os outros cinco
    // dias (com sufixo -feira obrigatório).
    const base = (match[1] ?? match[2])!.toLowerCase();
    const num = WEEKDAY_TO_NUMBER[base];
    if (num !== undefined) days.add(num);
  }

  // Activity 13/26, F10-B — segunda fonte: dias abreviados, só quando
  // na mesma frase que evidência de horário (ver extractAbbreviatedListDays).
  for (const num of extractAbbreviatedListDays(text)) {
    days.add(num);
  }

  return [...days].sort((a, b) => a - b);
}

/**
 * Activity 13/26, F5 Fix 2 — verdadeiro quando TODOS os dias
 * detectados no texto aparecem SÓ em forma de data explícita entre
 * parênteses ("sexta-feira (25/09)"), e não existe nenhum sinal
 * "todo/toda" independente. Instância nova a cada chamada, mesmo
 * motivo já documentado para TIME_RANGE_PATTERN/SINGLE_TIME_PATTERN
 * (lastIndex partilhado entre chamadas, Activity 10B).
 *
 * Caso real que exige o "E não há sinal todo/toda": "terá uma
 * novidade nesta sexta-feira (01/05). Toda sexta-feira, cães e gatos
 * encontram lar." — aqui HÁ uma data explícita, mas TAMBÉM um sinal
 * "todo/toda" independente, então a recorrência genuína permanece
 * detectada (Activity 8, Caso E — recorrência + ocorrência concreta).
 */
function hasOnlyDatedWeekdayMentions(text: string, allDays: readonly number[]): boolean {
  if (allDays.length === 0) return false;
  const datedPattern = new RegExp(DAY_WITH_PARENTHETICAL_DATE.source, DAY_WITH_PARENTHETICAL_DATE.flags);
  const datedMatches = [...text.matchAll(datedPattern)];
  const datedDays = new Set<number>();
  for (const m of datedMatches) {
    const dayNameMatch = m[0].match(/domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado/i);
    if (!dayNameMatch) continue;
    const num = WEEKDAY_TO_NUMBER[dayNameMatch[0].toLowerCase()];
    if (num !== undefined) datedDays.add(num);
  }
  // Activity 13/26, F10-A — forma inversa "DD de mês (dia-da-semana)",
  // instância nova, mesmo motivo já documentado (lastIndex partilhado).
  const inversePattern = new RegExp(INVERSE_DATED_WEEKDAY.source, INVERSE_DATED_WEEKDAY.flags);
  const inverseMatches = [...text.matchAll(inversePattern)];
  for (const m of inverseMatches) {
    const dayNameMatch = m[1]!.match(/domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado/i);
    if (!dayNameMatch) continue;
    const num = WEEKDAY_TO_NUMBER[dayNameMatch[0].toLowerCase()];
    if (num !== undefined) datedDays.add(num);
  }
  const allDaysAreDated = allDays.every((d) => datedDays.has(d));
  return allDaysAreDated && !RECURRENCE_SIGNAL_PATTERN.test(text);
}

function hasRecurrenceSignal(text: string): boolean {
  // Instâncias NOVAS de TIME_RANGE_PATTERN/SINGLE_TIME_PATTERN — nunca a
  // mesma instância usada por matchAll() em countTimeMentions(). Confirmado
  // por execução real, nesta Activity: mesmo com lastIndex resetado antes
  // de .test(), o matchAll() subsequente na MESMA instância ainda perdia
  // menções — só instâncias verdadeiramente separadas eliminam o problema
  // por completo. Mesmo princípio já usado por DAY_PATTERN (new RegExp(...)
  // antes de cada uso em detectWeekdays).
  const rangeCheck = new RegExp(TIME_RANGE_PATTERN.source, TIME_RANGE_PATTERN.flags);
  const singleCheck = new RegExp(SINGLE_TIME_PATTERN.source, SINGLE_TIME_PATTERN.flags);
  return RECURRENCE_SIGNAL_PATTERN.test(text) || rangeCheck.test(text) || singleCheck.test(text);
}

/**
 * Activity 10B, Part 1 — conta quantas menções de horário distintas
 * existem no texto: cada intervalo completo conta 1, cada horário
 * único (fora de qualquer intervalo já contado) conta 1. Nunca conta
 * o mesmo horário duas vezes.
 */
function countTimeMentions(text: string): { rangeCount: number; singleCount: number; total: number } {
  // Instâncias novas a cada chamada — mesmo motivo de hasRecurrenceSignal:
  // detectRecurrenceItems chama isto uma vez por item, num lote; reutilizar
  // as constantes módulo-level via matchAll() com estado de lastIndex
  // partilhado com outras chamadas (hasRecurrenceSignal) já provou, por
  // execução real, perder menções.
  const rangePattern = new RegExp(TIME_RANGE_PATTERN.source, TIME_RANGE_PATTERN.flags);
  const singlePattern = new RegExp(SINGLE_TIME_PATTERN.source, SINGLE_TIME_PATTERN.flags);
  const ranges = [...text.matchAll(rangePattern)];
  let masked = text;
  for (const r of ranges) masked = masked.replace(r[0], ' '.repeat(r[0].length));
  const singles = [...masked.matchAll(singlePattern)];
  return { rangeCount: ranges.length, singleCount: singles.length, total: ranges.length + singles.length };
}

/**
 * Texto candidato para detecção. Activity 8: title + description
 * (os únicos campos garantidamente presentes). Activity 10B, Part 4:
 * acrescenta, quando disponível em raw_payload e seguro, o contexto
 * adicional que os Collectors já preservam como evidência de fonte —
 * NUNCA dados interpretados:
 *   - narrative_fallback: raw_payload.raw_text (artigo completo já
 *     preservado desde a Activity 8, nunca antes consumido aqui);
 *   - structured_block, evento único: raw_payload.article_context_text
 *     (Activity 10B, Part 3 — só presente quando o Collector confirma
 *     que o artigo produziu exactamente 1 sub-evento).
 * Ambos são detectados por metadados já existentes em raw_payload
 * (extraction_method), nunca inferidos aqui.
 */
function buildCandidateText(item: RawActivityItem): string {
  const parts: string[] = [item.title, item.description ?? ''];

  const payload = item.raw_payload;
  const extractionMethod = payload?.['extraction_method'];
  if (extractionMethod === 'narrative_fallback' && typeof payload?.['raw_text'] === 'string') {
    parts.push(payload['raw_text'] as string);
  }
  if (typeof payload?.['article_context_text'] === 'string') {
    parts.push(payload['article_context_text'] as string);
  }

  return parts.filter(Boolean).join(' ');
}

/**
 * Activity 10B — mesma prioridade da Activity 8 para o hint verbatim
 * (description sobre title quando description contém o sinal), mas
 * agora também considera o contexto adicional (raw_text/
 * article_context_text) quando é onde o sinal de recorrência
 * realmente vive — sempre o campo INTEIRO de onde veio, nunca uma
 * reconstrução.
 */
function pickTextHint(item: RawActivityItem): string {
  const description = item.description ?? '';
  if (description && (detectWeekdays(description).length > 0 || hasRecurrenceSignal(description))) {
    return description;
  }

  const payload = item.raw_payload;
  const extractionMethod = payload?.['extraction_method'];
  if (extractionMethod === 'narrative_fallback' && typeof payload?.['raw_text'] === 'string') {
    const rawText = payload['raw_text'] as string;
    if (detectWeekdays(rawText).length > 0) return rawText;
  }
  if (typeof payload?.['article_context_text'] === 'string') {
    const contextText = payload['article_context_text'] as string;
    if (detectWeekdays(contextText).length > 0) return contextText;
  }

  return item.title;
}

/**
 * Detecta recorrência numa única RawActivityItem. Não modifica o item
 * — devolve sempre um par { item, recurrence }, com item sendo um
 * objecto NOVO (spread) quando recurrence_text_hint é populado, ou o
 * mesmo objecto de entrada quando nada é detectado (nenhuma mutação
 * em qualquer dos dois casos).
 */
/**
 * Activity 13/26, F6 — lógica de qualificação PURA, exportada para
 * reuso fora deste módulo (narrativeFallbackParser.ts). Responde só
 * "este texto tem evidência forte e determinística de recorrência
 * genuína?" — reutiliza exactamente a mesma sequência de gates já
 * usada dentro de detectRecurrence() (dia detectado, sinal de
 * recorrência, nunca só menção datada, nunca mensal-ordinal) — nunca
 * reimplementada, para nunca haver duas fontes de verdade sobre o que
 * conta como recorrência. Usada pelo Collector para decidir SE deve
 * criar um RawActivityItem sem ocorrência concreta — nunca para
 * calcular recurrence_type/days/time, que continuam exclusivamente
 * responsabilidade de detectRecurrence().
 */
export function hasQualifyingRecurrenceEvidence(text: string): boolean {
  const days = detectWeekdays(text);
  if (days.length === 0 || !hasRecurrenceSignal(text)) return false;
  if (hasOnlyDatedWeekdayMentions(text, days)) return false;
  if (ORDINAL_MONTH_PATTERN.test(text)) return false;
  return true;
}

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

  // Activity 13/26, F5 Fix 2 — guarda de referência datada. Confirmado
  // por evidência real (PNAB, São Pedro da Aldeia): um dia mencionado
  // só como referência a uma data única de publicação ("nesta
  // sexta-feira (25/09)"), combinado com um horário completamente não
  // relacionado noutra frase do mesmo texto ("até as 17h", prazo de
  // e-mail), passava o gate acima (dia + sinal de horário, ambos
  // presentes) e produzia recorrência falsa. Tratado exactamente como
  // a protecção de falso positivo já existente (Activity 8, Caso H) —
  // devolvido sem alteração, sem review_reason (não é uma recorrência
  // genuína com perda, é ausência de recorrência).
  if (hasOnlyDatedWeekdayMentions(candidateText, days)) {
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

  // Activity 10B, Part 2 — guarda de segurança mensal-ordinal. Se o
  // texto candidato contém "todo último domingo"/"na primeira
  // terça-feira"/etc., NUNCA classifica como weekly — o contrato
  // actual não consegue representar isto sem perda semântica (cada
  // domingo ≠ último domingo do mês). Verificado ANTES de qualquer
  // outra classificação, com precedência sobre o resultado semanal.
  if (ORDINAL_MONTH_PATTERN.test(candidateText)) {
    const textHint = pickTextHint(item);
    const updatedItem: RawActivityItem = item.recurrence_text_hint === textHint
      ? item
      : { ...item, recurrence_text_hint: textHint };

    return {
      item: updatedItem,
      recurrence: {
        recurrence_type: null,
        recurrence_days: null,
        recurrence_time: null,
        review_reasons: ['recurrence_ordinal_month_not_representable'],
      },
    };
  }

  const { rangeCount, total } = countTimeMentions(candidateText);
  const reviewReasons: RecurrenceReviewReason[] = [];
  let recurrenceTime: string | null = null;

  if (total === 1) {
    // Uma única menção de horário — intervalo ou horário único,
    // partilhado por todos os dias detectados. Reutiliza
    // parseTimeRangePt — não duplica parsing.
    const { time } = parseTimeRangePt(candidateText);
    recurrenceTime = time;
    if (rangeCount === 1) {
      // Veio de um intervalo completo — o fim nunca é persistido
      // nesta camada, mas nunca é perdido: fica recuperável, verbatim,
      // em recurrence_text_hint (comportamento da Activity 8, inalterado).
      reviewReasons.push('recurrence_end_time_not_persisted');
    }
    // Activity 10B, Part 1: quando a única menção é um horário ÚNICO
    // (sem intervalo), nada foi perdido — sem review_reason.
  } else if (total >= 2) {
    // Horários diferentes por dia — o contrato actual não consegue
    // representar isto fielmente com um único recurrence_time.
    // NUNCA escolher um dos horários arbitrariamente.
    recurrenceTime = null;
    reviewReasons.push('recurrence_per_day_times_not_representable');
  }
  // total === 0: recorrência sem horário publicado — recurrenceTime
  // permanece null, sem review_reasons.

  const textHint = pickTextHint(item);
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
