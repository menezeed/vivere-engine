/**
 * Configuração do PrefeituraAgendaCulturalCollector — Cabo Frio / RJ.
 *
 * Valores confirmados explicitamente antes da implementação:
 * - categoria "Cultura" (id=73), não "Agenda Cultural" (id=1737,
 *   abandonada desde 2023 — ver reconhecimento técnico)
 * - janela inicial de 30 dias (sinceDays), não o histórico completo
 *   de ~987 posts
 * - limite de segurança de páginas, para nunca depender só da janela
 *   de tempo como mecanismo de parada
 */

export const PREFEITURA_CABO_FRIO_CONFIG = {
  source_key: 'prefeitura_cabo_frio',
  base_url: 'https://noticias.cabofrio.rj.gov.br',
  category_id: 73, // "Cultura" — confirmado via /wp-json/wp/v2/categories?search=cultura
  per_page: 20,
  since_days: 30,
  max_pages: 10,           // limite de segurança: nunca pagina mais que 10 páginas (até 200 posts) numa execução
  delay_ms_between_pages: 300, // boa cidadania — não há orçamento monetário a proteger aqui, mas evita sobrecarregar o servidor da prefeitura
};
