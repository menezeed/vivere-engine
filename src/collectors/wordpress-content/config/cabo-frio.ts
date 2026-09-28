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
 *
 * Activity 13/26, 2026-09-27 — F5, Fix 1. O marcador anterior,
 * /servi[çc]o:?/i, casava a palavra narrativa comum "serviço"/
 * "serviços" em qualquer lugar do texto corrido (o ":" era opcional),
 * não só o rótulo estrutural "SERVIÇO:". Confirmado por evidência
 * real: um artigo administrativo de São Pedro da Aldeia (PNAB),
 * contendo "prestadores de serviços" em prosa comum, activou
 * incorrectamente o caminho structured_block. Corrigido para exigir
 * que o marcador esteja isolado dentro de <strong>...</strong> — o
 * padrão real de todos os casos genuínos confirmados nesta sessão
 * (Cabo Frio: "<strong>SERVIÇO:</strong>"; São Pedro: "<strong>Serviço</strong>",
 * sem dois-pontos). ":" continua opcional, porque o caso real de São
 * Pedro (Junho Violeta) confirma que nem toda fonte usa dois-pontos.
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

  structured_block_marker: /<strong>\s*servi[çc]o:?\s*<\/strong>/i,

  region_metadata: {
    city: 'Cabo Frio',
    state: 'RJ',
  },
};
