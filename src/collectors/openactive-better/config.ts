/**
 * Better (GLL) — feed OpenActive session-series. Piloto UK, SÓ LEITURA.
 *
 * Fonte: RPDE 1.0 público e nacional (~5 páginas de 500 itens, ~25 MB).
 * Licença declarada no próprio feed: CC BY 4.0 (atribuição obrigatória).
 * robots.txt de better-admin.org.uk (lido a 26/11/2026): "User-agent: * /
 * Disallow:" — tudo permitido. Mesmo assim: no máximo 8 pedidos por
 * execução, 3 s entre pedidos, e paragem imediata em HTTP 429/403.
 *
 * Só se guardam factos estruturados de uma allowlist (ver betterSeries.ts):
 * nunca descrições livres nem nomes de instrutores/leaders.
 */
import { UK_PILOT_PRODUCT } from '../u3a-siteworks/config';

export const BETTER_SOURCE_KEY = 'better_openactive_richmond';

export const BETTER_CONFIG = {
  source_key: BETTER_SOURCE_KEY,
  product_key: UK_PILOT_PRODUCT,
  display_name: 'Better (GLL) — OpenActive, Richmond',
  feed_url: 'https://better-admin.org.uk/api/openactive/better/session-series',
  feed_origin: 'https://better-admin.org.uk',
  timezone: 'Europe/London',
  user_agent: 'VivereEngine/1.0 (OpenActive; read-only)',
  max_requests_per_run: 8,
  min_interval_ms: 3_000,
  /** Janela de ocorrências geradas a partir do eventSchedule (dias, a contar de hoje, inclusive). */
  occurrence_window_days: 21,
  /** Áreas postais do borough de Richmond upon Thames (outward code completo). */
  richmond_postcode_areas: ['TW1', 'TW2', 'TW9', 'TW10', 'TW11', 'TW12', 'SW13', 'SW14'] as readonly string[],
  licence: {
    name: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Better (GLL), OpenActive, CC BY 4.0',
  },
  organisation_evidence: 'Better (GLL) gere centros desportivos para o público em geral; não dirige as sessões a pessoas mais velhas.',
} as const;
