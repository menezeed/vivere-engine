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
 * Variáveis de ambiente necessárias (ambiente de STAGING, nunca
 * produção): SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';

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
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_KEY'];
  if (!url || !key) {
    console.error('STOP: SUPABASE_URL/SUPABASE_SERVICE_KEY em falta.');
    process.exit(1);
  }

  console.log(`\n⚠ A validar: ${url}`);
  console.log('⚠ CONFIRMA MANUALMENTE que isto é STAGING, nunca produção, antes de prosseguir.\n');

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
  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error('ERRO FATAL:', err);
  process.exit(1);
});
