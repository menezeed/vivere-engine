/**
 * Configuração da fonte u3a SiteWorks — piloto UK (U2, 26/11/2026).
 * SÓ STAGING. Produto isolado (vivere-60-plus-uk-test); publicação
 * bloqueada para produtos não-BR até U8.
 */
import { getRegion, regionLocale, requireGeo, U3A_RICHMOND_SOURCE_KEY } from '../../config/regions';
import type { SourceConfigContract } from '../../persistence/types/collectorContracts';

export const UK_PILOT_PRODUCT = 'vivere-60-plus-uk-test';

export interface U3aSourceConfig extends SourceConfigContract {
  readonly display_name: string;
  readonly base_url: string;      // sem barra final
  readonly region_key: string;
  readonly region_label: string;  // source_region_label dos venues (gate geográfico)
  readonly timezone: string;      // horas da fonte são locais deste fuso (não convertidas)
  readonly user_agent: string;
}

const region = getRegion('richmond_upon_thames');
const geo = requireGeo(region);

export const U3A_RICHMOND_CONFIG: U3aSourceConfig = {
  source_key: U3A_RICHMOND_SOURCE_KEY,
  product_key: UK_PILOT_PRODUCT,
  display_name: 'Richmond upon Thames u3a',
  base_url: 'https://rut.u3asite.uk',
  region_key: region.key,
  region_label: region.city_label,
  timezone: regionLocale(region).timezone,
  user_agent: 'VivereEngine/1.0 (u3a pilot; read-only)',
  // ADR-0022 — o gate geográfico aplica-se aos venues (com lat/lng do postcodes.io).
  regions: [{ display_label: region.city_label, lat: geo.center.lat, lng: geo.center.lng, radius_m: geo.radius_m }],
};
