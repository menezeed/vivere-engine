import type { WordPressContentSourceConfig } from './WordPressContentSourceConfig';

/**
 * Instância HIPOTÉTICA: Prefeitura de Araruama / RJ.
 *
 * ATENÇÃO: esta configuração NÃO foi validada contra dry-run real.
 * Ela existe como prova de conceito de que o WordPressContentCollector
 * suporta múltiplas instâncias sem alteração de código — os valores
 * abaixo (base_url, category_id, structured_block_marker) são
 * PLACEHOLDERS plausíveis, não confirmados.
 *
 * Antes de usar esta config em produção/dry-run real, repita o
 * reconhecimento técnico completo já feito para Cabo Frio:
 *   1. Confirmar que o site é WordPress e expõe REST API
 *   2. Descobrir o category_id correto via /wp-json/wp/v2/categories
 *   3. Coletar exemplos reais de posts para confirmar o marcador de
 *      bloco estruturado em uso (pode ser "SERVIÇO:", "PROGRAMAÇÃO:",
 *      "AGENDA:", "INFORMAÇÕES:", ou nenhum — variando por prefeitura)
 *   4. Rodar dry-run e validar contra casos reais antes de qualquer
 *      persistência, exatamente como fizemos para Cabo Frio.
 */
export const ARARUAMA_CONFIG: WordPressContentSourceConfig = {
  source_key: 'prefeitura_araruama',
  display_name: 'Prefeitura de Araruama (NÃO VALIDADO)',
  product_key: 'vivere-60-mais',
  source_priority: 100,

  base_url: 'https://araruama.rj.gov.br', // PLACEHOLDER — confirmar domínio real do portal de notícias
  category_id: 0, // PLACEHOLDER — descobrir via /wp-json/wp/v2/categories?search=cultura antes de usar

  since_days: 30,
  max_pages: 10,
  per_page: 20,
  delay_ms_between_pages: 300,

  structured_block_marker: /servi[çc]o:?/i, // PLACEHOLDER — confirmar vocabulário real antes de usar

  region_metadata: {
    city: 'Araruama',
    state: 'RJ',
  },
};
