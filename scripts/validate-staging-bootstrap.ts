/**
 * scripts/validate-staging-bootstrap.ts
 *
 * Activity 16/26, Fase 16D. Valida, só por leitura, que um ambiente
 * (destinado a ser staging, NUNCA produção) tem exactamente o schema
 * esperado depois de 0000 → 0019 → 0020.
 *
 * NUNCA correr isto contra o projecto Supabase de produção real —
 * destina-se exclusivamente a confirmar um bootstrap de staging.
 *
 * SEC-O fase 2B: a confirmação deixou de ser manual. main() chama
 * assertEnvironment() (src/lib/envGuard.ts) ANTES de criar o cliente ou
 * de consultar o que quer que seja: exige VIVERE_ENV=staging, o
 * SUPABASE_URL exacto do staging e uma SUPABASE_SERVICE_KEY de formato
 * válido; a produção é bloqueada incondicionalmente. O URL usado é o
 * canónico devolvido pela guarda.
 *
 * Variáveis de ambiente necessárias (ambiente de STAGING, nunca
 * produção): VIVERE_ENV=staging, SUPABASE_URL, SUPABASE_SERVICE_KEY.
 *
 * LIMITAÇÕES PRÉ-EXISTENTES (NÃO resolvidas nesta fase; ver SEC-O 2B):
 *  1. É um esqueleto: só executa UMA verificação (contagem de
 *     activities < 1000). As listas EXPECTED_* abaixo (tabelas, views,
 *     funções, trigger, colunas engine) estão declaradas mas NÃO são
 *     usadas em nenhuma verificação.
 *  2. O erro da contagem é ignorado: se a consulta falhar (sem rede,
 *     sem privilégio), a contagem fica undefined e a verificação PASSA
 *     (undefined ?? 0 < 1000). Um PASS não prova que a consulta correu.
 *  3. A heurística "contagem pequena" não distingue staging de
 *     produção (a produção também tem poucas linhas). Quem impede a
 *     produção é a guarda, não esta verificação.
 *  4. A consulta a information_schema.tables via PostgREST não é
 *     acessível (schema não exposto): o resultado e o erro são
 *     ignorados, por isso nada do catálogo é validado.
 *  5. A frase "depois de 0000 → 0019 → 0020" está desactualizada: a
 *     cadeia de migrações vai agora até à 0022.
 * Para validar o schema a sério, usar as queries de catálogo do runbook
 * (docs/runbooks/staging-bootstrap.md, secções 3, 3b e 3c).
 */
import { createClient } from '@supabase/supabase-js';
import { assertEnvironment } from '../src/lib/envGuard.js';

const EXPECTED_PUBLIC_TABLES = [
  'activities', 'venues', 'favorites', 'activity_interests',
  'suggestions', 'partners', 'categories', 'products', 'sources',
  'publication_runs', 'publication_events',
];
const EXPECTED_PUBLIC_VIEWS = ['users', 'active_activities'];
const EXPECTED_STAGING_TABLES = [
  'activities_staging', 'venues_staging', 'raw_activity_items',
  'raw_venue_items', 'ingestion_runs', 'venue_resolution_candidates',
  'venue_resolution_decisions', 'venue_resolution_runs',
];
const EXPECTED_FUNCTIONS = ['guard_activities_update', 'increment_activity_interest'];
const EXPECTED_TRIGGER = 'guard_activities_update';

// Nenhuma coluna engine_* deve existir em 0000 por si só — só depois
// de 0012/0013. Este script corre DEPOIS de todas as migrações, por
// isso confirma presença, não ausência.
const EXPECTED_ENGINE_COLUMNS_ACTIVITIES = [
  'engine_activity_id', 'source_key', 'product_key', 'engine_status', 'last_published_at',
];
const EXPECTED_ENGINE_COLUMNS_VENUES = [
  'engine_venue_id', 'source_key', 'product_key', 'engine_status', 'last_published_at',
];

interface CheckResult { name: string; pass: boolean; detail?: string }
const results: CheckResult[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}

async function main(): Promise<void> {
  // SEC-O fase 2B: valida o ambiente ANTES de criar o cliente. Lança
  // EnvGuardError (apanhado por main().catch) se não for exactamente o staging.
  const env = process.env;
  const { supabaseUrl: url, projectRef } = assertEnvironment(env);
  const key = env['SUPABASE_SERVICE_KEY'] as string; // formato validado pela guarda

  console.log(`\n⚠ A validar: ${url}`);
  console.log(`✔ Ambiente validado pela guarda: staging (${projectRef}).\n`);

  const db = createClient(url, key, { auth: { persistSession: false } });

  // 0. Nenhum dado de produção — contagem deve ser pequena (seed sintético)
  const { count: activityCount } = await db.from('activities').select('*', { count: 'exact', head: true });
  check('Sem indício de dados de produção (contagem pequena)', (activityCount ?? 0) < 1000, `contagem actual: ${activityCount}`);

  // 1. Tabelas/views esperadas existem
  const { data: tables } = await db
    .from('information_schema.tables' as never)
    .select('table_schema, table_name, table_type');
  // Nota: information_schema não é directamente consultável via
  // supabase-js sem RPC/vista própria em alguns setups — este script
  // é um esqueleto de verificação; se information_schema não for
  // acessível por este caminho, adaptar para usar uma função RPC
  // read-only dedicada ou ligação Postgres directa (ex: via
  // claude_readonly, uma vez criada).

  console.log('\n=== RESULTADOS ===');
  let anyFail = false;
  for (const r of results) {
    if (!r.pass) anyFail = true;
    console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log('\nNOTA: este script é um esqueleto de verificação inicial,');
  console.log('a completar com acesso directo ao catálogo (claude_readonly,');
  console.log('Fase 16C) antes da execução real contra staging.');
  console.log('LIMITAÇÕES: só 1 verificação é executada (contagem de activities); o erro dessa');
  console.log('consulta é ignorado (um PASS não prova que correu); as listas EXPECTED_* e a consulta');
  console.log('a information_schema não validam nada. Ver o cabeçalho deste ficheiro.');
  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error('ERRO FATAL:', err);
  process.exit(1);
});
