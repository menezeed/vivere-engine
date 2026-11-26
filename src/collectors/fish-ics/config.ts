/**
 * FiSH Neighbourhood Care (charity 1147516) — piloto UK, só preview.
 *
 * Fonte: o ICS público do The Events Calendar. O robots.txt de
 * fishhelp.org.uk (lido a 26/11/2026) PROÍBE /wp-json/, /?rest_route=,
 * /*post_type=tribe_events e a paginação /events/.../page/; tem
 * Crawl-delay: 10. O URL abaixo não coincide com nenhum Disallow.
 * Um pedido por execução; nada de REST nem de paginação.
 */
import { UK_PILOT_PRODUCT } from '../u3a-siteworks/config';

export const FISH_SOURCE_KEY = 'fish_neighbourhood_care';

export const FISH_CONFIG = {
  source_key: FISH_SOURCE_KEY,
  product_key: UK_PILOT_PRODUCT,
  display_name: 'FiSH Neighbourhood Care',
  ics_url: 'https://www.fishhelp.org.uk/events/list/?ical=1',
  site_url: 'https://www.fishhelp.org.uk/',
  timezone: 'Europe/London',
  user_agent: 'VivereEngine/1.0 (Richmond 60+ pilot; read-only; one request per run)',
  /** Mínimo entre pedidos ao mesmo host (robots.txt: Crawl-delay 10). */
  min_interval_ms: 10_000,
  /**
   * Evidência ao nível da ORGANIZAÇÃO (cabeçalho do site e página Join us,
   * lidos a 26/11/2026). Não prova que cada actividade é 60+.
   */
  organisation_evidence: 'A FiSH apresenta-se como apoio "for the older community of Barnes, Mortlake and East Sheen".',
  membership: {
    required_text: 'A página Join us pede que quem participa nas actividades se torne membro.',
    fee_text: '£30 por ano (página Join us, 26/11/2026)',
    source_url: 'https://www.fishhelp.org.uk/join-us/',
  },
} as const;
