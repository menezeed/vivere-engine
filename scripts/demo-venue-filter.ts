/**
 * Demonstração do Venue Filtering Engine com exemplos sintéticos.
 * Não chama a Google Places API — usa RawVenueItem construídos à mão,
 * cobrindo os exemplos do pedido original (rejeitar, aceitar, revisão).
 *
 * Uso: npx tsx scripts/demo-venue-filter.ts
 */
import { filterVenueItems, summarizeFilterResults } from '../src/pipeline/stages/00-filter-venue';
import type { RawVenueItem } from '../src/types/RawVenueItem';

function makeItem(name: string, googleTypes: string[]): RawVenueItem {
  return {
    source_key: 'google_places',
    source_item_id: `demo_${name}`,
    collected_at: new Date().toISOString(),
    name,
    address: 'Endereço de demonstração',
    lat: -22.88,
    lng: -42.02,
    phone: null,
    website: null,
    opening_hours_raw: null,
    image_url: null,
    source_category_hint: 'demo',
    source_query_text: 'demo',
    source_query_kind: 'place_type',
    google_types: googleTypes,
    google_business_status: 'OPERATIONAL',
    raw_payload: {},
  };
}

const SAMPLE_ITEMS: RawVenueItem[] = [
  makeItem('Secretaria Municipal de Saúde', ['local_government_office']),
  makeItem('Wizard Idiomas Cabo Frio', ['school']),
  makeItem('Banco do Brasil - Agência Centro', ['bank']),
  makeItem('Posto Ipiranga', ['gas_station']),
  makeItem('Teatro Municipal de Cabo Frio', ['performing_arts_theater']),
  makeItem('Museu de Arte de Cabo Frio', ['museum']),
  makeItem('Biblioteca Pública Municipal', ['library']),
  makeItem('Centro de Convivência do Idoso', ['establishment']),
  makeItem('Feira Livre de Araruama', ['establishment']),
  makeItem('Praça da Bandeira', ['establishment']),
  makeItem('Monumento aos Pescadores', ['point_of_interest']),
  makeItem('Estabelecimento Genérico XYZ', ['establishment']),
];

const results = filterVenueItems(SAMPLE_ITEMS);

console.log('=== Venue Filtering Engine — demonstração com exemplos sintéticos ===\n');
for (const { item, filter } of results) {
  console.log(`[${filter.decision.toUpperCase()}] ${item.name}`);
  console.log(`  ${filter.reasoning}\n`);
}

console.log('=== Resumo ===');
console.log(summarizeFilterResults(results));
