/**
 * src/pipeline/stages/01-geographic-gate/applyGeographicGate.ts
 *
 * ADR-0022 — Regional Geographic Gate.
 *
 * Anota a saída do Venue Filtering Engine (00-filter-venue) com
 * classificação geográfica, ANTES de os itens avançarem para
 * venues_staging:
 *
 *   inside_radius   → decisão do filtro preservada sem alteração;
 *                     geographic anexado para auditoria.
 *   buffer_zone     → se a decisão efectiva for 'accepted', é forçada
 *                     para 'needs_review' (nunca ACCEPTED automático
 *                     na margem); qualquer outra decisão é preservada.
 *   outside_region  → decisão do filtro preservada; geographic.bucket
 *                     marca 'outside_region'. A PERSISTÊNCIA
 *                     (VenueStagingRepository) usa este metadado para
 *                     gravar proposal_status = 'geographic_excluded'
 *                     em vez de descartar o item.
 *
 * IMPORTANTE (pós-revisão arquitectural): este módulo NUNCA remove
 * itens do array — devolve sempre o mesmo número de itens que recebeu,
 * cada um com geographic anexado. "Excluído desta onda regional" é uma
 * afirmação sobre ELEGIBILIDADE PARA PUBLICAÇÃO NA REGIÃO CORRENTE, não
 * uma afirmação sobre a existência do dado — raw_venue_items já
 * preservou a evidência bruta antes deste ponto (Camada A é sempre
 * gravada, independentemente do gate), e agora venues_staging também
 * preserva o registo, apenas com um proposal_status que o mantém fora
 * da fila normal de Human Review e de qualquer promoção/publicação.
 *
 * Genérico: opera só sobre lat/lng do item e lat/lng/radius_m da região
 * — nenhuma condição específica de bairro/produto.
 */

import type { FilteredVenueItem } from '../../stages/00-filter-venue/index';
import { classifyItem } from './classifyDistance';
import type { GeographicRegion, GeographicallyLocatable, GeographicMetadata } from './types';

export type GeographicallyGatedItem<TRuleId extends string, TAmbiguityLabel extends string> =
  FilteredVenueItem<TRuleId, TAmbiguityLabel> & { readonly geographic: GeographicMetadata };

export function applyGeographicGate<TRuleId extends string, TAmbiguityLabel extends string>(
  results: readonly FilteredVenueItem<TRuleId, TAmbiguityLabel>[],
  regions: readonly GeographicRegion[],
): readonly GeographicallyGatedItem<TRuleId, TAmbiguityLabel>[] {
  return results.map((r) => {
    const classification = classifyItem(r.item as GeographicallyLocatable, regions);
    const geographic: GeographicMetadata = {
      bucket: classification.bucket,
      distanceMeters: classification.distanceMeters,
    };

    if (classification.bucket === 'buffer_zone' && r.filter.decision === 'accepted') {
      const distance = Math.round(classification.distanceMeters);
      const radius = classification.region?.radius_m ?? 0;
      return {
        ...r,
        filter: {
          ...r.filter,
          decision: 'needs_review',
          decisive_layer: 'review',
          reasoning: `${r.filter.reasoning} | geographic_buffer_zone: resultado a ${distance}m do centro da região (raio configurado: ${radius}m) — forçado para revisão, nunca ACCEPTED automático na margem (ADR-0022)`,
        },
        geographic,
      };
    }

    return { ...r, geographic };
  });
}
