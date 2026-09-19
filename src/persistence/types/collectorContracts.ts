import type { RawVenueItem } from '../../types/RawVenueItem';
import type { RawActivityItem } from '../../types/RawActivityItem';

/**
 * Contratos abstratos que a camada de persistência (Orchestrator) usa
 * para interagir com Collectors. A engine de persistência não importa
 * nenhuma classe concreta — depende apenas destas interfaces.
 *
 * A separação entre VenueCollector e ActivityCollector reflete a
 * distinção de autoridade epistêmica já estabelecida no modelo de
 * domínio (ADR-0002): são dois tipos diferentes de dado, com ciclos
 * de vida e destinos de persistência diferentes, e não faria sentido
 * unificá-los numa única interface genérica só para reduzir duplicação.
 *
 * TOptions é livre em cada interface — o Orchestrator passa as opções
 * que recebe dos scripts sem precisar conhecer o que cada Collector
 * faz com elas.
 */

/** Resultado mínimo que o Orchestrator precisa de qualquer Collector de venues. */
export interface VenueCollectorContract<TOptions = Record<string, unknown>> {
  readonly sourceKey: string;
  collect(options?: TOptions): Promise<{
    items: RawVenueItem[];
    errors: Array<{ message: string; source_item_id: string | null }>;
  }>;
}

/** Resultado mínimo que o Orchestrator precisa de qualquer Collector de atividades. */
export interface ActivityCollectorContract<TOptions = Record<string, unknown>> {
  readonly sourceKey: string;
  collect(options?: TOptions): Promise<{
    items: RawActivityItem[];
    errors: Array<{ message: string; source_item_id: string | null }>;
  }>;
}

/**
 * O que o Orchestrator precisa saber de uma configuração de Source:
 * apenas o product_key para usar como FK em staging. Todo o resto da
 * config (regiões, categorias, marcadores de bloco, URLs) pertence ao
 * Collector, nunca ao Orchestrator.
 */
export interface SourceConfigContract {
  readonly source_key: string;
  readonly product_key: string;
  /**
   * ADR-0022 (Regional Geographic Gate) — opcional, aditivo. Presente
   * apenas em fontes com noção de região geográfica (ex: Google Places).
   * Quando ausente, o gate não é aplicado — comportamento inalterado
   * para fontes sem geolocalização (ex: WordPress).
   */
  readonly regions?: readonly { display_label: string; lat: number; lng: number; radius_m: number }[];
}
