/**
 * Source Priority — modelo de prioridade entre fontes, para uso
 * futuro em três pontos do pipeline que ainda NÃO são implementados
 * nesta fase (a persistência em staging não começou):
 *
 *   1. Dedupe cross-source: quando dois Collectors diferentes
 *      descobrem o "mesmo" venue/activity, a fonte de maior
 *      priority é a que "vence" — ou seja, fica como o registro
 *      principal em staging, e a de menor priority é referenciada
 *      como fonte secundária (ver duplicate_candidates, já desenhado
 *      no schema de staging.activities_staging).
 *   2. Ordenação da fila de revisão: itens de fontes de alta
 *      priority podem ser exibidos primeiro ao revisor.
 *   3. Componente do confidence_score: priority alimenta o fator
 *      "source_trust_score" já definido no cálculo de confidence_score
 *      (substituindo/complementando o TIER_BASE_SCORE puro por tier).
 *
 * Esta tabela é dado de configuração, não lógica — mesma filosofia
 * de ruleLists.ts no Venue Filtering Engine. Pensada para crescer
 * com cada novo Collector sem exigir mudança de código em quem a
 * consome, só uma nova entrada aqui.
 */

export interface SourcePriorityEntry {
  source_key: string;
  display_name: string;
  priority: number; // 0-100, maior = mais confiável/autoritativa
  tier: 1 | 2 | 3;   // cadência de execução (já definido na arquitetura macro do VAIP)
  notes: string;
}

/**
 * Modelo inicial — confirmado explicitamente antes da implementação.
 * source_key segue o padrão já usado (snake_case, mesmo valor que
 * popula staging.sources.key e RawVenueItem/RawActivityItem.source_key).
 */
export const SOURCE_PRIORITY_TABLE: SourcePriorityEntry[] = [
  {
    source_key: 'prefeitura',
    display_name: 'Prefeitura',
    priority: 100,
    tier: 1,
    notes: 'Fonte oficial municipal — maior autoridade sobre atividades e venues públicos locais',
  },
  {
    source_key: 'sesc',
    display_name: 'SESC',
    priority: 95,
    tier: 1,
    notes: 'Rede nacional consolidada, programação estruturada e estável',
  },
  {
    source_key: 'senac',
    display_name: 'SENAC',
    priority: 95,
    tier: 1,
    notes: 'Mesmo perfil de confiabilidade do SESC',
  },
  {
    source_key: 'sympla',
    display_name: 'Sympla',
    priority: 90,
    tier: 1,
    notes: 'Plataforma de eventos com dados estruturados via API',
  },
  {
    source_key: 'eventbrite',
    display_name: 'Eventbrite',
    priority: 85,
    tier: 1,
    notes: 'Plataforma de eventos com dados estruturados via API',
  },
  {
    source_key: 'google_places',
    display_name: 'Google Places',
    priority: 70,
    tier: 2,
    notes: 'Excelente para descoberta de venues; não tem conceito de atividade/recorrência',
  },
  {
    source_key: 'facebook',
    display_name: 'Facebook',
    priority: 60,
    tier: 2,
    notes: 'Eventos geralmente únicos, qualidade de dado variável',
  },
  {
    source_key: 'instagram',
    display_name: 'Instagram',
    priority: 50,
    tier: 3,
    notes: 'Menor estrutura de dado, maior necessidade de interpretação/revisão',
  },
];

export function getSourcePriority(sourceKey: string): SourcePriorityEntry {
  const entry = SOURCE_PRIORITY_TABLE.find((e) => e.source_key === sourceKey);
  if (!entry) {
    // Fonte desconhecida não deveria travar o pipeline — mas também
    // não deveria silenciosamente ganhar prioridade alta. Default
    // conservador: tratada como a fonte de menor confiança conhecida.
    return {
      source_key: sourceKey,
      display_name: sourceKey,
      priority: 40,
      tier: 3,
      notes: 'Fonte não cadastrada em SOURCE_PRIORITY_TABLE — prioridade default conservadora atribuída',
    };
  }
  return entry;
}

/**
 * Compara duas fontes e retorna qual delas deveria prevalecer em
 * caso de conflito de dedupe cross-source. Não decide AUTOMATICAMENTE
 * por conta própria em produção — assim como toda decisão de dedupe
 * difuso já definida na arquitetura, isto produz um SINAL para a
 * decisão humana de revisão, não uma ação automática.
 */
export function compareSourcePriority(sourceKeyA: string, sourceKeyB: string): -1 | 0 | 1 {
  const a = getSourcePriority(sourceKeyA).priority;
  const b = getSourcePriority(sourceKeyB).priority;
  if (a === b) return 0;
  return a > b ? -1 : 1; // -1 significa "A deveria prevalecer sobre B"
}
