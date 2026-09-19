import type { RawActivityItem, RawOccurrence } from '../../types/RawActivityItem';
import { parseServicoBlock, type ServicoSubEvent, type ServicoReviewReason } from './parsers/servicoBlockParser';
import { parseNarrativeFallback, type NarrativeReviewReason } from './parsers/narrativeFallbackParser';

/**
 * Orquestração das duas camadas de extração:
 *   1. servicoBlockParser roda primeiro, sempre.
 *   2. Se encontrar 1+ sub-eventos válidos, esses são usados — a
 *      camada 2 NUNCA roda neste caso. Não há mecanismo de "mesclar"
 *      ou "competir" entre as duas camadas, por design: a camada 1
 *      é estruturalmente mais confiável sempre que encontra o
 *      marcador SERVIÇO, então seu resultado é definitivo.
 *   3. Só quando a camada 1 não encontra o marcador (found === false)
 *      OU encontra o marcador mas nenhum sub-evento com título
 *      reconhecível (caso de borda: bloco SERVIÇO malformado), a
 *      camada 2 é executada.
 *
 * Mapeamento de revisão por motivo, espelhando a mesma convenção já
 * usada no GooglePlacesCollector (extraction_method/extraction_confidence
 * dentro de raw_payload) — RawActivityItem não tem campos nativos de
 * confidence/review, esses são metadados internos deste extrator,
 * preservados em raw_payload para auditoria e uso futuro pelo painel
 * de revisão.
 */

export type ExtractionMethod = 'servico_block' | 'narrative_fallback' | 'none';

export type MapReviewReason =
  | NarrativeReviewReason
  | ServicoReviewReason
  | 'servico_subevent_missing_date'  // sub-evento da camada 1 sem data extraída
  | 'narrative_ambiguous'             // camada 2 retornou status ambiguous
  | 'no_extractable_schedule_found';  // nem camada 1 nem camada 2 encontraram nada

export interface WordPressPostInput {
  id: number;
  title: string;
  contentHtml: string;
  link: string;
  publishedAt: { year: number; month: number; isoDate: string };
  imageUrl: string | null;
}

export interface MapResult {
  items: RawActivityItem[];
  /** posts (ou sub-eventos) que não geraram item algum, com motivo — para os errors[] do CollectorResult */
  skipped: Array<{ reason: MapReviewReason; context: string }>;
  extractionMethod: ExtractionMethod;
}

const CONFIDENCE_SERVICO_BLOCK = 0.9;

function servicoSubEventToOccurrence(ev: ServicoSubEvent): RawOccurrence | null {
  if (!ev.date) return null;
  return { date: ev.date, time: ev.time, end_date: null, end_time: ev.endTime };
}

function buildItemFromServicoSubEvent(
  post: WordPressPostInput,
  ev: ServicoSubEvent,
  subEventIndex: number,
): RawActivityItem {
  const occurrence = servicoSubEventToOccurrence(ev);
  const reviewReasons: MapReviewReason[] = [];
  if (!occurrence) reviewReasons.push('servico_subevent_missing_date');
  if (ev.reviewReason) reviewReasons.push(ev.reviewReason);

  return {
    source_key: 'prefeitura_cabo_frio',
    source_item_id: `${post.id}_${subEventIndex}`,
    collected_at: new Date().toISOString(),

    title: ev.title,
    description: null,
    raw_category_text: null,

    occurrences: occurrence ? [occurrence] : [],
    recurrence_text_hint: null,

    venue_mention: ev.venueName
      ? { raw_text: ev.venueName, raw_address_text: null, confidence_hint: 'explicit_name' }
      : null,

    price_text: null,
    is_free_hint: null,

    image_url: post.imageUrl,
    external_url: post.link,
    contact_phone: null,
    contact_email: null,

    language: 'pt',

    raw_payload: {
      wp_post_id: post.id,
      wp_post_title: post.title,
      sub_event_index: subEventIndex,
      extraction_method: 'servico_block' satisfies ExtractionMethod,
      extraction_confidence: CONFIDENCE_SERVICO_BLOCK,
      review_reasons: reviewReasons,
      raw_text: ev.rawBlockText,
    },
  };
}

function buildItemFromNarrative(
  post: WordPressPostInput,
  narrative: ReturnType<typeof parseNarrativeFallback>,
): RawActivityItem {
  const occurrence: RawOccurrence | null = narrative.date
    ? { date: narrative.date, time: narrative.time, end_date: null, end_time: narrative.endTime }
    : null;

  return {
    source_key: 'prefeitura_cabo_frio',
    source_item_id: `${post.id}_0`,
    collected_at: new Date().toISOString(),

    title: post.title,  // camada 2 nunca decompõe sub-títulos — usa o título do post inteiro
    description: null,
    raw_category_text: null,

    occurrences: occurrence ? [occurrence] : [],
    recurrence_text_hint: null,

    venue_mention: narrative.venueName
      ? { raw_text: narrative.venueName, raw_address_text: null, confidence_hint: 'inferred_from_context' }
      : null,

    price_text: null,
    is_free_hint: null,

    image_url: post.imageUrl,
    external_url: post.link,
    contact_phone: null,
    contact_email: null,

    language: 'pt',

    raw_payload: {
      wp_post_id: post.id,
      wp_post_title: post.title,
      sub_event_index: 0,
      extraction_method: 'narrative_fallback' satisfies ExtractionMethod,
      extraction_confidence: narrative.confidence,
      review_reasons: narrative.reviewReasons,
      raw_text: narrative.rawText,
      candidate_dates: narrative.candidateDates,  // preservado mesmo no caminho de sucesso, para auditoria
    },
  };
}

export function mapToRawActivityItems(post: WordPressPostInput): MapResult {
  const servico = parseServicoBlock(post.contentHtml, {
    year: post.publishedAt.year,
    month: post.publishedAt.month,
  });

  // Camada 1 encontrou e extraiu pelo menos 1 sub-evento: usa
  // EXCLUSIVAMENTE esse resultado. A camada 2 não roda — não há
  // tentativa de "complementar" ou "validar contra" a narrativa.
  if (servico.found && servico.subEvents.length > 0) {
    const items = servico.subEvents.map((ev, idx) => buildItemFromServicoSubEvent(post, ev, idx));
    const skipped = servico.subEvents
      .map((ev, idx) => ({ ev, idx }))
      .filter(({ ev }) => !ev.date)
      .map(({ idx }) => ({
        reason: 'servico_subevent_missing_date' as const,
        context: `post ${post.id}, sub-evento ${idx} ("${servico.subEvents[idx].title}")`,
      }));

    return { items, skipped, extractionMethod: 'servico_block' };
  }

  // Camada 1 não encontrou nada utilizável (marcador ausente, ou
  // presente mas sem sub-evento com título reconhecível): tenta a
  // camada 2, e SÓ a camada 2 — nunca em conjunto com a 1.
  const narrative = parseNarrativeFallback(post.contentHtml, {
    year: post.publishedAt.year,
    month: post.publishedAt.month,
  });

  if (narrative.status === 'extracted') {
    return {
      items: [buildItemFromNarrative(post, narrative)],
      skipped: [],
      extractionMethod: 'narrative_fallback',
    };
  }

  if (narrative.status === 'ambiguous') {
    return {
      items: [],
      skipped: [
        {
          reason: 'narrative_ambiguous',
          context: `post ${post.id} ("${post.title}"): ${narrative.ambiguityReason}`,
        },
      ],
      extractionMethod: 'narrative_fallback',
    };
  }

  // narrative.status === 'not_found' — nem camada 1 nem camada 2
  // encontraram qualquer sinal de programação neste post.
  return {
    items: [],
    skipped: [
      {
        reason: 'no_extractable_schedule_found',
        context: `post ${post.id} ("${post.title}")`,
      },
    ],
    extractionMethod: 'none',
  };
}
