import type { WordPressContentSourceConfig } from './WordPressContentSourceConfig';

/**
 * Instância: Prefeitura de Rio das Ostras / RJ.
 *
 * Reconhecimento L1 (14/11/2026), só endpoints públicos:
 *   1. O site é WordPress e expõe a REST API (/wp-json/wp/v2) em
 *      https://www.riodasostras.rj.gov.br (com "www").
 *   2. category_id = 17 ("Cultura", filha de 1; 1157 posts), via
 *      /wp-json/wp/v2/categories?search=cultura. Últimos posts: 12/11,
 *      10/11, 06/11, 04/11 (2x), 29/10 — cerca de 1–2 por semana.
 *   3. Existe uma SEGUNDA categoria "Cultura" (153, slug cultura-2,
 *      991 posts, último 27/10) e "Eventos" (25, 716 posts). Só a 17 é
 *      configurada aqui; cobrir a 153/25 exige suporte a várias
 *      categorias ou outra instância (decisão em aberto, ver L1).
 *   4. robots.txt devolve 404 (não há restrições declaradas).
 *   5. Muitos posts têm bloco estruturado "<strong>SERVIÇO</strong>"
 *      (sem dois-pontos) seguido de Local:/Endereço:/Data:/Horário:,
 *      o mesmo vocabulário do motor; os restantes são narrativos.
 *
 * Ainda NÃO validada por dry-run real nem por ingestão persistida.
 */
export const RIO_DAS_OSTRAS_CONFIG: WordPressContentSourceConfig = {
  source_key: 'prefeitura_rio_das_ostras',
  display_name: 'Prefeitura de Rio das Ostras (NÃO VALIDADO em dry-run)',
  product_key: 'vivere-60-mais',
  source_priority: 100, // fonte oficial de prefeitura, igual a Cabo Frio

  base_url: 'https://www.riodasostras.rj.gov.br',
  category_id: 17, // "Cultura" — L1, 14/11/2026 (ver nota 3 sobre a 153)

  since_days: 30,
  max_pages: 10,
  per_page: 20,
  delay_ms_between_pages: 300,

  structured_block_marker: /<strong>\s*servi[çc]o:?\s*<\/strong>/i,

  region_metadata: {
    city: 'Rio das Ostras',
    state: 'RJ',
  },
};
