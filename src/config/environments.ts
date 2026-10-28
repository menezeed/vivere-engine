/**
 * Refs públicos dos projectos Supabase do Vivere (SEC-O, fase 1).
 *
 * O "ref" é o identificador PÚBLICO de um projecto: o subdomínio de
 * https://<ref>.supabase.co. Não é um segredo (aparece em URLs, em
 * cabeçalhos de resposta e nas assinaturas de schema). Nunca ponha aqui
 * chaves, palavras-passe ou qualquer outro valor secreto.
 *
 * Usado por src/lib/envGuard.ts para garantir que o desenvolvimento local
 * só fala com o staging, e que a produção nunca é seleccionada por engano.
 */

export const SUPABASE_PROJECT_REFS = {
  staging: 'jvtcgomwbfojsttepcfc',
  production: 'ccpqngyupukdefaqvzgl',
} as const;

export type EnvironmentName = keyof typeof SUPABASE_PROJECT_REFS;

/** URL base canónico de um projecto (sem barra final). */
export function supabaseUrlFor(environment: EnvironmentName): string {
  return `https://${SUPABASE_PROJECT_REFS[environment]}.supabase.co`;
}
