import type { WordPressContentSourceConfig } from './WordPressContentSourceConfig';

/**
 * Instância real: Prefeitura de Cabo Frio / RJ — categoria "Cultura".
 *
 * Validada contra dry-run real (ver documento de validação da Fase 1).
 * Marcador de bloco confirmado: "SERVIÇO:" — vocabulário observado em
 * múltiplos posts reais da fonte (Yoga no Forte, Arraiás, BeepYoga,
 * Canto do Forte).
 *
 * source_priority = 100 conforme a tabela de Source Priority da
 * plataforma (Prefeitura é a fonte de maior confiança/autoridade
 * para atividades e venues públicos locais).
 */
export const CABO_FRIO_CONFIG: WordPressContentSourceConfig = {
  source_key: 'prefeitura_cabo_frio',
  display_name: 'Prefeitura de Cabo Frio',
  product_key: 'vivere-60-mais',
  source_priority: 100,

  base_url: 'https://noticias.cabofrio.rj.gov.br',
  category_id: 73, // "Cultura" — confirmado via /wp-json/wp/v2/categories?search=cultura; NÃO usar 1737 ("Agenda Cultural", abandonada desde 2023)

  since_days: 30,
  max_pages: 10,
  per_page: 20,
  delay_ms_between_pages: 300,

  structured_block_marker: /servi[çc]o:?/i,

  region_metadata: {
    city: 'Cabo Frio',
    state: 'RJ',
  },
};
