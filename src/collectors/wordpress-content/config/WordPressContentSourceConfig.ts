/**
 * Configuração de uma INSTÂNCIA do WordPressContentCollector.
 *
 * O motor (WordPressContentCollector, WordPressApiClient, parsers/)
 * nunca conhece "Cabo Frio", "Araruama" ou qualquer outro nome de
 * lugar — ele só conhece esta interface. Cada prefeitura/organização
 * real é um arquivo em config/ que implementa este contrato.
 *
 * O que é configurável por instância (decisão explícita do usuário):
 *   - URL base, categoria WordPress, janela de coleta
 *   - cidade/região (metadado, não usado para lógica — só para log/auditoria)
 *   - source_key e source priority (qual prioridade esta fonte tem no dedupe)
 *   - product_key (para qual produto Vivere esta instância alimenta)
 *   - marcador de bloco estruturado (SERVIÇO:/PROGRAMAÇÃO:/AGENDA:/INFORMAÇÕES:)
 *
 * O que é FIXO no motor, não configurável por instância (decisão
 * explícita do usuário — vocabulário comum de agenda em português,
 * promovível a configuração futuramente se uma fonte real exigir):
 *   - rótulos "Dia:", "Data:", "Horário:", "Local:"
 */
export interface WordPressContentSourceConfig {
  /** Identidade da fonte — usado em staging.sources.key e em todos os RawActivityItem.source_key */
  source_key: string;

  /** Nome legível, usado em logs e no painel de revisão — nunca em lógica */
  display_name: string;

  /** Para qual produto da plataforma Vivere esta instância alimenta staging */
  product_key: string;

  /** Prioridade desta fonte no dedupe cross-source (ver staging/config de Source Priority da plataforma) */
  source_priority: number;

  /** Conexão com a fonte real */
  base_url: string;
  category_id: number;

  /** Janela e limites de segurança da coleta */
  since_days: number;
  max_pages: number;
  per_page: number;
  delay_ms_between_pages: number;

  /**
   * Marcador de bloco estruturado — o motor procura este padrão no
   * HTML do post para decidir se a camada 1 (alta confiança) se
   * aplica. Cada instância declara o vocabulário real que sua fonte
   * usa. Exemplos reais de variação esperada entre prefeituras:
   * "SERVIÇO:", "PROGRAMAÇÃO:", "AGENDA:", "INFORMAÇÕES:".
   */
  structured_block_marker: RegExp;

  /** Metadado livre, só para log/auditoria — NUNCA usado em lógica de extração */
  region_metadata?: {
    city?: string;
    state?: string;
  };
}
