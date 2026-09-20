/**
 * src/publishing/repositories/impl/PublishableActivityRepository.ts
 * Lê activities com decisão humana prontas para publicar. Zero escrita.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPublishableActivityRepository } from '../interfaces.js';
import type {
  PublishableActivity,
  ActivityOccurrence,
  StagingActivityId,
  StagingVenueId,
  PublicVenueId,
  PublicActivityId,
  ActivityFunnel,
} from '../../types/domain.js';
import { logger } from '../../../lib/logger.js';

// Sprint 8.7 (bugfix de schema real): a SELECT original assumia body_text,
// event_date, source_url, phone, updated_at — nenhum destes existe. Nomes
// corrigidos: description, occurrences (jsonb), external_url, contact_phone,
// collected_at (ver PublishableVenueRepository — mesmo raciocínio de dirty
// signal, ADR aplicável ao venue estende-se por analogia ao activity).
const SELECT = `
  id, product_key, promoted_activity_id, resolved_venue_staging_id, venue_resolution_status,
  raw_activity_items!inner (
    source_key,
    title, description, occurrences, image_url, external_url, contact_phone,
    collected_at
  )
`;

/**
 * Parser tolerante de occurrences (Sprint 8.7, bug de persistência a corrigir
 * separadamente no Collector/repositório de escrita — ver ADR-0020, nota de
 * migração). Linhas antigas gravaram um array JSON serializado como STRING
 * dentro do jsonb (jsonb_typeof = 'string'); linhas novas, após o fix do
 * Collector, gravam um array jsonb nativo. Aceita ambos; qualquer outra
 * forma é um erro explícito — nunca falha silenciosamente para [].
 *
 * NOTA (correcção pós-Sprint 2, achado real): esta função continua a
 * lançar excepção para formatos que não têm `date` (ex: entradas
 * recorrentes no formato { day_of_week, time }, sem data específica).
 * Isso é intencional aqui — o contrato de occurrences NÃO foi ampliado
 * para suportar recorrência por dia da semana; essa continua a ser uma
 * decisão de produto em aberto (ver docs/regional-baselines/
 * activity-engine-discovery-1.2.md). O que mudou é ONDE esta excepção é
 * apanhada — ver enrichWithPublicVenueIds() abaixo — para que uma
 * activity com este problema não impeça a leitura das restantes.
 */
export function parseOccurrences(raw: unknown): readonly ActivityOccurrence[] {
  let value: unknown = raw;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error(`occurrences: string não é JSON válido: ${String(raw).slice(0, 120)}`);
    }
  }

  if (!Array.isArray(value)) {
    throw new Error(`occurrences: esperado array (nativo ou serializado), recebido ${typeof value}`);
  }

  return value.map((entry, index): ActivityOccurrence => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`occurrences[${index}]: esperado objecto, recebido ${typeof entry}`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e['date'] !== 'string') {
      throw new Error(`occurrences[${index}].date: esperado string, recebido ${typeof e['date']}`);
    }
    return {
      date:    e['date'],
      time:    typeof e['time']    === 'string' ? e['time']    : null,
      endDate: typeof e['end_date'] === 'string' ? e['end_date'] : null,
      endTime: typeof e['end_time'] === 'string' ? e['end_time'] : null,
    };
  });
}

function mapRow(
  row:      Record<string, unknown>,
  venueMap: Map<string, string>,
): PublishableActivity {
  const raw = row['raw_activity_items'] as Record<string, unknown>;
  const stagingVenueId = row['resolved_venue_staging_id'] as string | null;

  return {
    stagingId:             row['id'] as StagingActivityId,
    productKey:            row['product_key'] as string,
    sourceKey:             (raw['source_key'] as string | null) ?? 'prefeitura_cabo_frio',
    title:                 (raw['title'] as string | null) ?? '',
    description:           (raw['description'] as string | null) ?? null,
    occurrences:           parseOccurrences(raw['occurrences']),
    // Placeholders — ver comentário no tipo PublishableActivity (domain.ts).
    // occurrences é a fonte de verdade; a ocorrência seleccionada só existe
    // depois do PublicationTransformer (ADR-0020).
    startDate:             null,
    endDate:               null,
    imageUrl:              (raw['image_url'] as string | null) ?? null,
    sourceUrl:             (raw['external_url'] as string | null) ?? null,
    phone:                 (raw['contact_phone'] as string | null) ?? null,
    resolvedPublicVenueId: stagingVenueId
      ? (venueMap.get(stagingVenueId) ?? null) as PublicVenueId | null
      : null,
    // Sprint 8.7 — necessário para distinguir, no preview, proposed_new
    // genuína de matched cujo venue ainda não foi promovido nesta run.
    venueResolutionStatus:  row['venue_resolution_status'] as 'matched' | 'proposed_new',
    resolvedVenueStagingId: stagingVenueId as StagingVenueId | null,
    promotedActivityId:    (row['promoted_activity_id'] as string | null) as PublicActivityId | null,
    // Sprint 8.7 (bugfix de schema real): activities_staging não tem coluna
    // updated_at (mesmo problema documentado em PublishableVenueRepository).
    // Sinal correcto: raw_activity_items.collected_at.
    stagingUpdatedAt:      new Date(raw['collected_at'] as string ?? Date.now()),
  };
}

export class PublishableActivityRepository implements IPublishableActivityRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findUnpublished(productKey: string): Promise<readonly PublishableActivity[]> {
    const { data, error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .in('venue_resolution_status', ['matched', 'proposed_new'])
      .is('promoted_activity_id', null);

    if (error) throw new Error(`PublishableActivityRepository.findUnpublished: ${error.message}`);
    return this.enrichWithPublicVenueIds((data ?? []) as Record<string, unknown>[]);
  }

  async findDirty(productKey: string): Promise<readonly PublishableActivity[]> {
    const { data, error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select(SELECT)
      .eq('product_key', productKey)
      .in('venue_resolution_status', ['matched', 'proposed_new'])
      .not('promoted_activity_id', 'is', null);

    if (error) throw new Error(`PublishableActivityRepository.findDirty: ${error.message}`);
    return this.enrichWithPublicVenueIds((data ?? []) as Record<string, unknown>[]);
  }

  /**
   * Sprint 8.7 — método aditivo, puramente informativo (ver interface).
   * Lê TODAS as activities_staging de um produto, sem qualquer filtro por
   * venue_resolution_status ou promoted_activity_id — ao contrário de
   * findUnpublished()/findDirty(), que só veem o subconjunto elegível.
   */
  async describeFunnel(productKey: string): Promise<ActivityFunnel> {
    const { data, error } = await this.db
      .schema('staging')
      .from('activities_staging')
      .select('venue_resolution_status, promoted_activity_id')
      .eq('product_key', productKey);

    if (error) throw new Error(`PublishableActivityRepository.describeFunnel: ${error.message}`);

    const rows = (data ?? []) as { venue_resolution_status: string | null; promoted_activity_id: string | null }[];
    const byVenueResolutionStatus: Record<string, number> = {};
    let alreadyPublished = 0;

    for (const row of rows) {
      const status = row.venue_resolution_status ?? 'unresolved';
      byVenueResolutionStatus[status] = (byVenueResolutionStatus[status] ?? 0) + 1;
      if (row.promoted_activity_id !== null) alreadyPublished++;
    }

    return { total: rows.length, byVenueResolutionStatus, alreadyPublished };
  }

  /**
   * Resolve staging venue IDs para public venue IDs.
   * Necessário porque public.activities.venue_id referencia public.venues.id,
   * mas em staging temos apenas o staging venue ID.
   *
   * CORRECÇÃO (pós-Sprint 2): antes, o mapeamento de cada linha (via
   * mapRow(), que chama parseOccurrences() internamente) era feito com
   * `rows.map(...)`. Se QUALQUER linha tivesse um `occurrences` inválido
   * (ex: formato de recorrência por dia da semana, sem `date`), a excepção
   * lançada por parseOccurrences() propagava-se através do `.map()`,
   * rejeitando esta função inteira — e, por consequência, findUnpublished()
   * e findDirty() — antes de qualquer activity, válida ou não, ser devolvida.
   * Isto contradizia directamente a responsabilidade já documentada no
   * cabeçalho de ActivityPublisher.ts: "um erro numa activity não interrompe
   * o processamento das restantes" — essa garantia só existia no loop de
   * decisão/execução do Publisher, nunca nesta etapa de leitura.
   *
   * Agora cada linha é processada isoladamente: uma falha é registada via
   * log estruturado (stagingId, source, título, motivo) para investigação,
   * e a linha é excluída do resultado — nunca publicada, nunca silenciosa
   * a ponto de ser irrecuperável para auditoria, mas também não impede as
   * restantes linhas válidas de chegarem ao Publisher.
   *
   * Não contabilizado em ActivityPublicationMetrics.errors — isso exigiria
   * alargar IPublishableActivityRepository para devolver também uma
   * contagem/lista de falhas, uma mudança de contrato maior do que esta
   * correcção se propõe a fazer. Registado aqui como limitação conhecida,
   * não resolvida silenciosamente.
   */
  private async enrichWithPublicVenueIds(
    rows: Record<string, unknown>[],
  ): Promise<readonly PublishableActivity[]> {
    // Recolher todos os staging venue IDs únicos
    const stagingVenueIds = [
      ...new Set(
        rows
          .map(r => r['resolved_venue_staging_id'] as string | null)
          .filter((id): id is string => id !== null),
      ),
    ];

    // Buscar os promoted_venue_id correspondentes em venues_staging
    const venueMap = new Map<string, string>();
    if (stagingVenueIds.length > 0) {
      const { data: venues } = await this.db
        .schema('staging')
        .from('venues_staging')
        .select('id, promoted_venue_id')
        .in('id', stagingVenueIds)
        .not('promoted_venue_id', 'is', null);

      for (const v of venues ?? []) {
        if (v.promoted_venue_id) {
          venueMap.set(v.id as string, v.promoted_venue_id as string);
        }
      }
    }

    const results: PublishableActivity[] = [];
    for (const r of rows) {
      try {
        results.push(mapRow(r, venueMap));
      } catch (err) {
        const raw = r['raw_activity_items'] as Record<string, unknown> | undefined;
        logger.error(
          {
            stagingId: r['id'],
            sourceKey: raw?.['source_key'],
            title:     raw?.['title'],
            reason:    err instanceof Error ? err.message : String(err),
          },
          'PublishableActivityRepository: activity excluída da run — occurrences inválido',
        );
      }
    }
    return results;
  }
}
