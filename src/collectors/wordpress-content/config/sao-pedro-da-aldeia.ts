import type { WordPressContentSourceConfig } from './WordPressContentSourceConfig';

/**
 * Instância: Prefeitura de São Pedro da Aldeia / RJ.
 *
 * Activity 13/26, 2026-09-27 — actualização de contexto, sem mudar o
 * essencial da nota original: esta configuração continua a NÃO ter
 * sido validada por uma ingestão real persistida. A Actividade 12
 * confirmou, por dry-run real não persistente, que category 49
 * ("Eventos") + since_days=30 produz 0 posts elegíveis — não por bug
 * de paginação, mas porque não há posts recentes suficientes nessa
 * categoria dentro da janela. A Actividade 13 confirmou ainda,
 * também por evidência real (API REST directa), que pelo menos uma
 * série recorrente genuína e actual (Feira de Adoção da ONG UZCA) é
 * publicada com categorização editorial INCONSISTENTE entre edições
 * — uma edição real teve categoria "Eventos" (49), outra "Uncategorized"
 * — confirmando que uma estratégia baseada apenas em categoria não
 * garante cobertura completa desta fonte. Nenhuma mudança de
 * category_id/since_days foi autorizada ou aplicada nesta correcção —
 * ver Activity 13, Strategy D, ainda não aprovada.
 *
 * O que continua confirmado, sem chamada de API paga:
 *   1. O site é WordPress e expõe a REST API.
 *   2. category_id = 49 ("Eventos", 134 posts) confirmado via
 *      /wp-json/wp/v2/categories?search=eventos.
 *   3. O conteúdo é predominantemente NARRATIVO — múltiplos posts
 *      reais confirmados (Festa do Sal, Feira de Adoção, Junho
 *      Violeta) têm data/hora embutida em texto corrido, sem bloco
 *      "SERVIÇO:"/"PROGRAMAÇÃO:"/"AGENDA:" — mas casos estruturados
 *      REAIS também existem: confirmado "Junho Violeta"
 *      (<strong>Serviço</strong>, sem dois-pontos, seguido de
 *      Evento:/Data:/Horário:/Local:/Público-alvo:).
 *
 * O que ainda falta confirmar antes de qualquer dry-run persistido:
 *   1. Estratégia de selecção de fonte definitiva (Activity 13,
 *      Strategy D em avaliação — sem decisão ainda).
 *   2. Rodar dry-run real com volume suficiente e validar contra mais
 *      casos reais antes de qualquer persistência.
 */
export const SAO_PEDRO_DA_ALDEIA_CONFIG: WordPressContentSourceConfig = {
  source_key: 'prefeitura_sao_pedro_da_aldeia',
  display_name: 'Prefeitura de São Pedro da Aldeia (categoria confirmada, cobertura ainda em avaliação — Activity 13)',
  product_key: 'vivere-60-mais',
  source_priority: 100, // mesma prioridade de Cabo Frio — fonte oficial de prefeitura

  base_url: 'https://pmspa.rj.gov.br', // confirmado: WordPress, REST API responde
  category_id: 49, // "Eventos" — confirmado via /wp-json/wp/v2/categories?search=eventos (134 posts). Cobertura incompleta confirmada (Activity 13) — não alterado nesta correcção.

  since_days: 30,
  max_pages: 10,
  per_page: 20,
  delay_ms_between_pages: 300,

  // Activity 13/26, 2026-09-27 — F5, Fix 1. Mesmo marcador corrigido
  // de Cabo Frio, agora confirmado compatível com o formato REAL desta
  // fonte: "<strong>Serviço</strong>" (Junho Violeta, sem dois-pontos,
  // confirmado por fetch directo da fonte real nesta Actividade).
  structured_block_marker: /<strong>\s*servi[çc]o:?\s*<\/strong>/i,

  region_metadata: {
    city: 'São Pedro da Aldeia',
    state: 'RJ',
  },
};
