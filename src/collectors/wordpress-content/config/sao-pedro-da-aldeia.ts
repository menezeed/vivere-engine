import type { WordPressContentSourceConfig } from './WordPressContentSourceConfig';

/**
 * Instância HIPOTÉTICA: Prefeitura de São Pedro da Aldeia / RJ.
 *
 * ATENÇÃO: esta configuração NÃO foi validada contra dry-run real.
 * Existe como o próximo candidato mais forte da matriz de fontes de
 * Activities (Sprint 1 — Activity Engine Discovery), mas os valores
 * abaixo (category_id, structured_block_marker) são PLACEHOLDERS
 * plausíveis, não confirmados.
 *
 * O que JÁ foi confirmado, nesta investigação, sem chamada de API paga:
 *   1. O site É WordPress e expõe a REST API — confirmado via
 *      https://pmspa.rj.gov.br/wp-json/wp/v2/posts?per_page=1
 *      (devolveu JSON, não erro)
 *   2. category_id = 49 ("Eventos", 134 posts) confirmado via
 *      /wp-json/wp/v2/categories?search=eventos. Duas outras
 *      categorias existem — "Cultura" (id 39, 1.509 posts) e
 *      "Turismo" (id 45, 500 posts) — descartadas por serem mais
 *      amplas/institucionais, prováveis fontes de ruído (notícias sem
 *      data de evento específica) em vez do volume mais estreito e
 *      alinhado de "Eventos".
 *   3. O conteúdo é NARRATIVO, não estruturado — múltiplos posts reais
 *      (Festa do Sal, Fest Verão, Festival Mulheres de Sal, aniversário
 *      da cidade) têm data/hora embutida em texto corrido
 *      ("neste sábado (30/05)... com início às 18h"), sem nenhum bloco
 *      tipo "SERVIÇO:"/"PROGRAMAÇÃO:"/"AGENDA:" observado. Isso sugere
 *      que o parser NARRATIVO do motor (não o de bloco estruturado) é
 *      o caminho relevante aqui — mas nenhum post individual foi lido
 *      por completo para confirmar isso com certeza.
 *
 * O que AINDA falta confirmar, antes de qualquer dry-run real:
 *   1. Confirmar se existe ALGUM marcador estruturado em uso, mesmo que
 *      raro — o motor tenta a camada 1 (alta confiança) antes de cair
 *      no fallback narrativo; se nenhum marcador for esperado, vale
 *      confirmar com quem conhece o motor se isso precisa de um valor
 *      "nulo"/regex que nunca casa, ou se algum valor placeholder aqui
 *      é inofensivo
 *   2. Rodar dry-run e validar contra casos reais antes de qualquer
 *      persistência, exatamente como já feito para Cabo Frio
 */
export const SAO_PEDRO_DA_ALDEIA_CONFIG: WordPressContentSourceConfig = {
  source_key: 'prefeitura_sao_pedro_da_aldeia',
  display_name: 'Prefeitura de São Pedro da Aldeia (categoria confirmada, marcador NÃO confirmado)',
  product_key: 'vivere-60-mais',
  source_priority: 100, // mesma prioridade de Cabo Frio — fonte oficial de prefeitura

  base_url: 'https://pmspa.rj.gov.br', // confirmado: WordPress, REST API responde
  category_id: 49, // "Eventos" — confirmado via /wp-json/wp/v2/categories?search=eventos (134 posts)

  since_days: 30,
  max_pages: 10,
  per_page: 20,
  delay_ms_between_pages: 300,

  // PLACEHOLDER — evidência disponível sugere que este site não usa
  // bloco estruturado (conteúdo é narrativo); regex herdada de
  // Cabo Frio só por convenção de preenchimento do contrato, nunca
  // confirmada aqui. Provavelmente o parser narrativo do motor é o
  // caminho real, não este marcador.
  structured_block_marker: /servi[çc]o:?/i,

  region_metadata: {
    city: 'São Pedro da Aldeia',
    state: 'RJ',
  },
};
