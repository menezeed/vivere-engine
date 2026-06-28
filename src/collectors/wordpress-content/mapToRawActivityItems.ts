import type { RawActivityItem, RawOccurrence } from '../../types/RawActivityItem';
import { parseStructuredBlock, type StructuredSubEvent, type StructuredBlockReviewReason } from './parsers/structuredBlockParser';
import { parseNarrativeFallback, type NarrativeReviewReason } from './parsers/narrativeFallbackParser';
import type { WordPressContentSourceConfig } from './config/WordPressContentSourceConfig';

/**
 * Orquestração das duas camadas de extração:
 *   1. structuredBlockParser roda primeiro, sempre, usando o marcador
 *      de bloco configurado para esta instância da fonte (ver
 *      WordPressContentSourceConfig.structured_block_marker).
 *   2. Se encontrar 1+ sub-eventos válidos, esses são usados — a
 *      camada 2 NUNCA roda neste caso. Não há mecanismo de "mesclar"
 *      ou "competir" entre as duas camadas, por design: a camada 1
 *      é estruturalmente mais confiável sempre que encontra o
 *      marcador configurado, então seu resultado é definitivo.
 *   3. Só quando a camada 1 não encontra o marcador (found === false)
 *      OU encontra o marcador mas nenhum sub-evento com título
 *      reconhecível (caso de borda: bloco malformado), a camada 2
 *      é executada.
 *
 * Mapeamento de revisão por motivo, espelhando a mesma convenção já
 * usada no GooglePlacesCollector (extraction_method/extraction_confidence
 * dentro de raw_payload) — RawActivityItem não tem campos nativos de
 * confidence/review, esses são metadados internos deste extrator,
 * preservados em raw_payload para auditoria e uso futuro pelo painel
 * de revisão.
 */

export type ExtractionMethod = 'structured_block' | 'narrative_fallback' | 'none';

export type MapReviewReason =
  | NarrativeReviewReason
  | StructuredBlockReviewReason
  | 'structured_subevent_missing_date'  // sub-evento da camada 1 sem data extraída
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

const CONFIDENCE_STRUCTURED_BLOCK = 0.9;

function structuredSubEventToOccurrence(ev: StructuredSubEvent): RawOccurrence | null {
  if (!ev.date) return null;
  return { date: ev.date, time: ev.time, end_date: null, end_time: ev.endTime };
}

function buildItemFromStructuredSubEvent(
  post: WordPressPostInput,
  ev: StructuredSubEvent,
  subEventIndex: number,
  sourceKey: string,
): RawActivityItem {
  const occurrence = structuredSubEventToOccurrence(ev);
  const reviewReasons: MapReviewReason[] = [];
  if (!occurrence) reviewReasons.push('structured_subevent_missing_date');
  if (ev.reviewReason) reviewReasons.push(ev.reviewReason);

  return {
    source_key: sourceKey,
    source_item_id: `${post.id}_${subEventIndex}`,
    collected_at: new Date().toISOString(),

    title: ev.title,
    description: null,
    raw_category_text: null,

    occurrences: occurrence ? [occurrence] : [],
    recurrence_text_hint: null,

    venue_name: ev.venueName,
    venue_address: null,
    venue_lat: null,
    venue_lng: null,
    venue_phone: null,
    venue_website: null,

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
      extraction_method: 'structured_block' satisfies ExtractionMethod,
      extraction_confidence: CONFIDENCE_STRUCTURED_BLOCK,
      review_reasons: reviewReasons,
      raw_text: ev.rawBlockText,
    },
  };
}

function buildItemFromNarrative(
  post: WordPressPostInput,
  narrative: ReturnType<typeof parseNarrativeFallback>,
  sourceKey: string,
): RawActivityItem {
  const occurrence: RawOccurrence | null = narrative.date
    ? { date: narrative.date, time: narrative.time, end_date: null, end_time: narrative.endTime }
    : null;

  return {
    source_key: sourceKey,
    source_item_id: `${post.id}_0`,
    collected_at: new Date().toISOString(),

    title: post.title,  // camada 2 nunca decompõe sub-títulos — usa o título do post inteiro
    description: null,
    raw_category_text: null,

    occurrences: occurrence ? [occurrence] : [],
    recurrence_text_hint: null,

    venue_name: narrative.venueName,
    venue_address: null,
    venue_lat: null,
    venue_lng: null,
    venue_phone: null,
    venue_website: null,

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

export function mapToRawActivityItems(
  post: WordPressPostInput,
  sourceConfig: Pick<WordPressContentSourceConfig, 'source_key' | 'structured_block_marker'>,
): MapResult {
  const structuredResult = parseStructuredBlock(
    post.contentHtml,
    { year: post.publishedAt.year, month: post.publishedAt.month },
    sourceConfig.structured_block_marker,
  );

  // Camada 1 encontrou e extraiu pelo menos 1 sub-evento: usa
  // EXCLUSIVAMENTE esse resultado. A camada 2 não roda — não há
  // tentativa de "complementar" ou "validar contra" a narrativa.
  if (structuredResult.found && structuredResult.subEvents.length > 0) {
    const items = structuredResult.subEvents.map((ev, idx) =>
      buildItemFromStructuredSubEvent(post, ev, idx, sourceConfig.source_key),
    );
    const skipped = structuredResult.subEvents
      .map((ev, idx) => ({ ev, idx }))
      .filter(({ ev }) => !ev.date)
      .map(({ idx }) => ({
        reason: 'structured_subevent_missing_date' as const,
        context: `post ${post.id}, sub-evento ${idx} ("${structuredResult.subEvents[idx].title}")`,
      }));

    return { items, skipped, extractionMethod: 'structured_block' };
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
      items: [buildItemFromNarrative(post, narrative, sourceConfig.source_key)],
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
