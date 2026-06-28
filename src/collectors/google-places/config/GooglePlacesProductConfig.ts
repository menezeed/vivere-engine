/**
 * Configuração de uma INSTÂNCIA do GooglePlacesCollector para um
 * determinado produto da plataforma Vivere.
 *
 * O motor (GooglePlacesCollector, GooglePlacesApiClient) nunca
 * conhece "Região dos Lagos", "Cabo Frio" ou qualquer outro nome de
 * lugar/categoria — ele só conhece esta interface. Cada produto real
 * (Vivere 60+, Vivere Turismo, etc.) declara sua própria combinação
 * de regiões e categorias em config/<produto>.ts.
 *
 * Duas dimensões deliberadamente INDEPENDENTES, para poder recombinar
 * livremente entre produtos:
 *   - regions: ONDE buscar (cidades/coordenadas)
 *   - categories: O QUE buscar (termos de busca + tipo de intenção)
 *
 * O produto de saída (queries reais) é o produto cartesiano das duas
 * — buildQueriesForProduct() monta isso, e nem essa função nem o
 * Collector têm qualquer suposição sobre quantas regiões ou
 * categorias existem (nada de if/else binário entre exatamente 2
 * cidades, como o código original tinha).
 */

export interface GooglePlacesRegion {
  /** Identificador estável da região — usado em logs e auditoria, nunca em lógica condicional */
  key: string;
  /** Nome legível usado para compor o texto da query (ex: "Cabo Frio RJ") */
  display_label: string;
  lat: number;
  lng: number;
  radius_m: number;
}

export interface GooglePlacesCategory {
  key: string;
  query_text: string;
  kind: 'place_type' | 'activity_intent';
}

export interface GooglePlacesProductConfig {
  /** Para qual produto da plataforma Vivere esta instância alimenta staging */
  product_key: string;
  source_priority: number;

  regions: GooglePlacesRegion[];
  categories: GooglePlacesCategory[];

  monthly_budget_usd: number;
  hard_stop_enabled: boolean;
  alert_threshold_pct: number;
}

export interface PlaceSearchQuery {
  region_key: string;
  category_key: string;
  query_text: string;
  query_kind: 'place_type' | 'activity_intent';
}

/**
 * Produto cartesiano de regions x categories — funciona para
 * qualquer número de regiões e qualquer número de categorias, sem
 * suposição alguma sobre quais ou quantas existem.
 */
export function buildQueriesForProduct(config: GooglePlacesProductConfig): PlaceSearchQuery[] {
  const queries: PlaceSearchQuery[] = [];

  for (const region of config.regions) {
    for (const category of config.categories) {
      queries.push({
        region_key: region.key,
        category_key: category.key,
        query_text: `${category.query_text} em ${region.display_label}`,
        query_kind: category.kind,
      });
    }
  }

  return queries;
}

export function findRegion(config: GooglePlacesProductConfig, regionKey: string): GooglePlacesRegion {
  const region = config.regions.find((r) => r.key === regionKey);
  if (!region) {
    throw new Error(`Região "${regionKey}" não encontrada na configuração deste produto`);
  }
  return region;
}
