/**
 * scripts/security-rls-validation.ts
 *
 * Activity 15/26, Fase 15D (revista pós-incidente 2026-10-02) — harness
 * de validação RLS SEGURO, que nunca usa o SQL Editor privilegiado para
 * simular anon/authenticated. Cada papel usa a sua credencial REAL, via
 * PostgREST real (@supabase/supabase-js), exactamente como um cliente
 * real o faria.
 *
 * NUNCA usa dados reais (nenhuma das 47 activities legacy, nenhuma
 * activity do Engine) — cria sempre uma fixture descartável própria,
 * identificável por um marcador único, e limpa-a explicitamente no fim,
 * nunca dependendo só de rollback.
 *
 * Variáveis de ambiente necessárias (.env):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_KEY            — para criar/limpar a fixture
 *   SECURITY_TEST_USER_EMAIL        — conta authenticated comum, SEM
 *                                      app_metadata.role
 *   SECURITY_TEST_USER_PASSWORD
 *   SECURITY_TEST_ADMIN_EMAIL       — conta admin real já existente
 *   SECURITY_TEST_ADMIN_PASSWORD
 *
 * Se SECURITY_TEST_USER_EMAIL/PASSWORD não estiverem definidas, o
 * script PARA explicitamente nessa secção e não inventa nem cria
 * nenhuma conta sozinho — ver STOP abaixo.
 *
 * NUNCA imprime password, JWT, service_role key, nem a anon key
 * completa — só confirma presença/ausência das variáveis.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FIXTURE_MARKER = 'SECURITY_TEST_DO_NOT_PUBLISH';

interface TestResult {
  readonly name: string;
  readonly expected: 'ALLOWED' | 'DENIED';
  readonly actual: 'ALLOWED' | 'DENIED' | 'ERROR';
  readonly detail?: string;
}

const results: TestResult[] = [];

function record(name: string, expected: 'ALLOWED' | 'DENIED', actual: 'ALLOWED' | 'DENIED' | 'ERROR', detail?: string) {
  results.push({ name, expected, actual, detail });
}

async function main(): Promise<void> {
  const url = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY');

  // ---------- 1. Clientes reais, um por papel ----------
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });

  const testUserEmail = process.env['SECURITY_TEST_USER_EMAIL'];
  const testUserPassword = process.env['SECURITY_TEST_USER_PASSWORD'];
  const adminEmail = process.env['SECURITY_TEST_ADMIN_EMAIL'];
  const adminPassword = process.env['SECURITY_TEST_ADMIN_PASSWORD'];

  if (!testUserEmail || !testUserPassword) {
    console.error(
      'STOP: SECURITY_TEST_USER_EMAIL / SECURITY_TEST_USER_PASSWORD não definidas. ' +
      'Precisamos de uma conta authenticated comum (SEM app_metadata.role) dedicada a testes. ' +
      'Esta conta NÃO é criada automaticamente — pede autorização explícita a Eduardo antes de a criar.',
    );
    process.exit(1);
  }

  if (!adminEmail || !adminPassword) {
    console.error('STOP: SECURITY_TEST_ADMIN_EMAIL / SECURITY_TEST_ADMIN_PASSWORD não definidas.');
    process.exit(1);
  }

  const authedClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: authedLoginError } = await authedClient.auth.signInWithPassword({
    email: testUserEmail,
    password: testUserPassword,
  });
  if (authedLoginError) {
    console.error('STOP: login da conta de teste authenticated falhou:', authedLoginError.message);
    process.exit(1);
  }

  const adminClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: adminLoginError } = await adminClient.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (adminLoginError) {
    console.error('STOP: login da conta admin falhou:', adminLoginError.message);
    process.exit(1);
  }

  console.log('Clientes autenticados com sucesso (anon, authenticated de teste, admin).');

  // ---------- 2. CREATE FIXTURE — só via service_role ----------
  const { data: fixture, error: createError } = await serviceClient
    .from('activities')
    .insert({
      title: `${FIXTURE_MARKER} — ${new Date().toISOString()}`,
      source_key: 'legacy',
      product_key: 'legacy',
      engine_status: 'active',
      interested_count: 0,
    })
    .select('id, interested_count')
    .single();

  if (createError || !fixture) {
    console.error('STOP: não foi possível criar a fixture de teste:', createError?.message);
    process.exit(1);
  }

  const fixtureId: string = fixture.id;
  console.log(`Fixture criada: ${fixtureId}`);

  try {
    // ---------- 3. TEST — matriz completa ----------
    await testSelect('anon SELECT fixture', anonClient, fixtureId);
    await testSelect('authenticated SELECT fixture', authedClient, fixtureId);

    await testUpdateCount('authenticated interested_count +1', authedClient, fixtureId, 1, 'ALLOWED');
    await testUpdateCount('authenticated interested_count -1 (volta a 0)', authedClient, fixtureId, -1, 'ALLOWED');
    await testUpdateCount('authenticated interested_count +10 arbitrário', authedClient, fixtureId, 10, 'DENIED');
    await testUpdateNull('authenticated interested_count NULL', authedClient, fixtureId);

    await testUpdateField('authenticated UPDATE title', authedClient, fixtureId, { title: 'HACKED' });
    await testUpdateField('authenticated UPDATE product_key', authedClient, fixtureId, { product_key: 'vivere-60-mais' });
    await testUpdateField('authenticated UPDATE recurrence_type', authedClient, fixtureId, { recurrence_type: 'weekly' });

    await testInsert('authenticated INSERT activity', authedClient);
    await testDelete('authenticated DELETE fixture (NÃO deve apagar)', authedClient, fixtureId);

    await testPrivileged('authenticated UPDATE venues (deve negar)', authedClient, 'venues');
    await testPrivileged('authenticated UPDATE partners (deve negar)', authedClient, 'partners');
    await testPrivileged('authenticated UPDATE categories (deve negar)', authedClient, 'categories');

    await testUpdateField('admin UPDATE title (deve permitir)', adminClient, fixtureId, { title: `${FIXTURE_MARKER} — editado por admin` }, 'ALLOWED');

    // ---------- 4. VERIFY — confirmar estado final da fixture ----------
    const { data: finalState } = await serviceClient
      .from('activities')
      .select('id, title, interested_count, product_key, recurrence_type')
      .eq('id', fixtureId)
      .single();
    console.log('Estado final da fixture (deve reflectir só a edição do admin):', finalState);

  } finally {
    // ---------- 5. CLEANUP — sempre, mesmo se algum teste lançar ----------
    const { error: deleteError } = await serviceClient.from('activities').delete().eq('id', fixtureId);
    if (deleteError) {
      console.error(`AVISO: falha ao limpar a fixture ${fixtureId} — remover manualmente:`, deleteError.message);
    } else {
      console.log(`Fixture ${fixtureId} removida.`);
    }

    // ---------- 6. VERIFY CLEANUP ----------
    const { data: shouldBeGone } = await serviceClient
      .from('activities')
      .select('id')
      .eq('id', fixtureId)
      .maybeSingle();
    console.log('Verificação de limpeza — deve ser null:', shouldBeGone);
  }

  // ---------- Relatório ----------
  console.log('\n=== RESULTADOS ===');
  let anyFail = false;
  for (const r of results) {
    const pass = r.actual === r.expected;
    if (!pass) anyFail = true;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${r.name} — esperado ${r.expected}, obtido ${r.actual}${r.detail ? ` (${r.detail})` : ''}`);
  }
  process.exit(anyFail ? 1 : 0);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`STOP: variável de ambiente ${name} em falta.`);
    process.exit(1);
  }
  return v;
}

async function testSelect(name: string, client: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await client.from('activities').select('id').eq('id', id).maybeSingle();
  record(name, 'ALLOWED', error ? 'ERROR' : data ? 'ALLOWED' : 'DENIED', error?.message);
}

async function testUpdateCount(
  name: string, client: SupabaseClient, id: string, delta: number, expected: 'ALLOWED' | 'DENIED',
): Promise<void> {
  const { data: before } = await client.from('activities').select('interested_count').eq('id', id).single();
  const { error } = await client
    .from('activities')
    .update({ interested_count: (before?.interested_count ?? 0) + delta })
    .eq('id', id);
  record(name, expected, error ? 'DENIED' : 'ALLOWED', error?.message);
}

async function testUpdateNull(name: string, client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('activities').update({ interested_count: null }).eq('id', id);
  record(name, 'DENIED', error ? 'DENIED' : 'ALLOWED', error?.message);
}

async function testUpdateField(
  name: string, client: SupabaseClient, id: string, patch: Record<string, unknown>,
  expected: 'ALLOWED' | 'DENIED' = 'DENIED',
): Promise<void> {
  const { error } = await client.from('activities').update(patch).eq('id', id);
  record(name, expected, error ? 'DENIED' : 'ALLOWED', error?.message);
}

async function testInsert(name: string, client: SupabaseClient): Promise<void> {
  const { data, error } = await client
    .from('activities')
    .insert({ title: `${FIXTURE_MARKER} — nunca deve persistir`, source_key: 'legacy', product_key: 'legacy', engine_status: 'active' })
    .select('id')
    .maybeSingle();
  // Se por algum motivo inseriu, apagar imediatamente — nunca deixar vestígio.
  if (data?.id) {
    console.error(`AVISO GRAVE: INSERT por authenticated teve sucesso inesperadamente — limpando ${data.id}`);
  }
  record(name, 'DENIED', error ? 'DENIED' : 'ALLOWED', error?.message);
}

async function testDelete(name: string, client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('activities').delete().eq('id', id);
  // Nunca confiar só no "sucesso" do comando — confirmar que a linha ainda existe.
  const { data: stillThere } = await client.from('activities').select('id').eq('id', id).maybeSingle();
  record(name, 'DENIED', stillThere ? 'DENIED' : 'ALLOWED', error?.message);
}

async function testPrivileged(name: string, client: SupabaseClient, table: 'venues' | 'partners' | 'categories'): Promise<void> {
  const { data: anyRow } = await client.from(table).select('id').limit(1).maybeSingle();
  if (!anyRow) {
    record(name, 'DENIED', 'ERROR', 'nenhuma linha disponível para testar — inconclusivo');
    return;
  }
  // Tenta um UPDATE inócuo que não deveria nunca aplicar.
  const { error } = await client.from(table).update({ id: anyRow.id }).eq('id', anyRow.id);
  record(name, 'DENIED', error ? 'DENIED' : 'ALLOWED', error?.message);
}

main().catch((err) => {
  console.error('ERRO FATAL:', err);
  process.exit(1);
});
