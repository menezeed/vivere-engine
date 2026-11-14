import type { WordPressContentSourceConfig } from './WordPressContentSourceConfig';

/**
 * Instância: Prefeitura de Armação dos Búzios / RJ.
 *
 * Reconhecimento L1 (14/11/2026), só endpoints públicos:
 *   1. O site é WordPress e expõe a REST API (/wp-json/wp/v2).
 *   2. category_id = 1415 ("Cultura e Patrimônio Histórico", 226 posts),
 *      via /wp-json/wp/v2/categories?search=cultura. Últimos posts:
 *      27/10, 20/10, 14/10, 10/09, 08/09 — cerca de 2–3 por mês.
 *   3. Alternativa descartada por agora: 41 ("Eventos", 343 posts), mas
 *      quase parada (1 post desde out/2025).
 *   4. robots.txt (Yoast) não restringe nada ("Disallow:" vazio).
 *   5. Conteúdo predominantemente NARRATIVO (blocos Gutenberg
 *      <p class="wp-block-paragraph">), sem bloco "Serviço" nos posts
 *      observados; a categoria mistura eventos com editais e notas
 *      institucionais, que o parser narrativo deve rejeitar.
 *
 * Ainda NÃO validada por dry-run real nem por ingestão persistida.
 */
export const BUZIOS_CONFIG: WordPressContentSourceConfig = {
  source_key: 'prefeitura_buzios',
  display_name: 'Prefeitura de Armação dos Búzios (NÃO VALIDADO em dry-run)',
  product_key: 'vivere-60-mais',
  source_priority: 100, // fonte oficial de prefeitura, igual a Cabo Frio

  base_url: 'https://buzios.rj.gov.br',
  category_id: 1415, // "Cultura e Patrimônio Histórico" — L1, 14/11/2026

  since_days: 30,
  max_pages: 10,
  per_page: 20,
  delay_ms_between_pages: 300,

  // Mesmo marcador de Cabo Frio; nenhum bloco "Serviço" foi observado
  // nesta fonte, por isso a camada 2 (narrativa) é o caminho esperado.
  structured_block_marker: /<strong>\s*servi[çc]o:?\s*<\/strong>/i,

  region_metadata: {
    city: 'Armação dos Búzios',
    state: 'RJ',
  },
};
