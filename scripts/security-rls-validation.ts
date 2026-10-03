/**
 * scripts/security-rls-validation.ts
 *
 * Activity 15/26, Fase 15D (revista pós-incidente 2026-10-02, revista
 * novamente após 1ª execução real 2026-10-03) — harness de validação
 * RLS SEGURO.
 *
 * Correcção 2026-10-03: testPrivilegedOnFixture() e
 * testAdminPrivilegedOnFixture() deixam de confiar apenas no campo
 * `error` da resposta do PostgREST. Em Postgres, um UPDATE bloqueado
 * por RLS (sem policy aplicável) NÃO lança erro — simplesmente não
 * afecta nenhuma linha, silenciosamente (ao contrário de uma violação
 * de WITH CHECK, que lança erro real). A 1ª execução real confundiu
 * "sem erro" com "permitido" para estas duas tabelas, produzindo um
 * falso FAIL. Ambas as funções agora fazem um SELECT de confirmação
 * (via serviceClient, que sempre vê o estado real) depois da tentativa,
 * e só então classificam ALLOWED/DENIED pela mudança real observada —
 * nunca pelo código de resposta sozinho.
 *
 * NUNCA usa dados reais (nenhuma das 47 activities legacy, nenhuma
 * activity do Engine, nenhum venue/partner/category real) — cria
 * sempre uma fixture descartável própria por tabela testada,
 * identificável pelo marcador SECURITY_TEST_DO_NOT_PUBLISH, e limpa-a
 * explicitamente no fim, nunca dependendo só de rollback.
 *
 * Fail-closed no cleanup: se qualquer fixture não puder ser confirmada
 * como removida no fim, o processo termina com código de saída != 0
 * (FAIL), mesmo que todos os testes de autorização tenham passado.
 *
 * Variáveis de ambiente necessárias (.env):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_KEY            — para criar/limpar fixtures
 *   SECURITY_TEST_USER_EMAIL        — conta authenticated comum, SEM
 *                                      app_metadata.role
 *   SECURITY_TEST_USER_PASSWORD
 *   SECURITY_TEST_ADMIN_EMAIL       — a ÚNICA conta com
 *                                      app_metadata.role='admin'
 *   SECURITY_TEST_ADMIN_PASSWORD
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
const createdFixtures: { table: string; id: string }[] = [];

function record(name: string, expected: 'ALLOWED' | 'DENIED', actual: 'ALLOWED' | 'DENIED' | 'ERROR', detail?: string) {
  results.push({ name, expected, actual, detail });
}

async function main(): Promise<void> {
  const url = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY');

  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });

  const testUserEmail = process.env['SECURITY_TEST_USER_EMAIL'];
  const testUserPassword = process.env['SECURITY_TEST_USER_PASSWORD'];
  const adminEmail = process.env['SECURITY_TEST_ADMIN_EMAIL'];
  const adminPassword = process.env['SECURITY_TEST_ADMIN_PASSWORD'];

  if (!testUserEmail || !testUserPassword) {
    console.error('STOP: SECURITY_TEST_USER_EMAIL / SECURITY_TEST_USER_PASSWORD em falta.');
    process.exit(1);
  }
  if (!adminEmail || !adminPassword) {
    console.error('STOP: SECURITY_TEST_ADMIN_EMAIL / SECURITY_TEST_ADMIN_PASSWORD em falta.');
    process.exit(1);
  }

  const authedClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: authedLoginError } = await authedClient.auth.signInWithPassword({ email: testUserEmail, password: testUserPassword });
  if (authedLoginError) {
    console.error('STOP: login da conta de teste authenticated falhou:', authedLoginError.message);
    process.exit(1);
  }

  const adminClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: adminLoginError } = await adminClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
  if (adminLoginError) {
    console.error('STOP: login da conta admin falhou:', adminLoginError.message);
    process.exit(1);
  }

  // Confirmação explícita de que a conta admin tem mesmo o claim certo
  // — falha cedo e claramente, em vez de produzir resultados confusos
  // mais tarde como na execução anterior.
  const { data: adminUser } = await adminClient.auth.getUser();
  const adminRole = (adminUser?.user?.app_metadata as Record<string, unknown> | undefined)?.['role'];
  if (adminRole !== 'admin') {
    console.error(`STOP: a conta em SECURITY_TEST_ADMIN_EMAIL não tem app_metadata.role='admin' (tem: ${adminRole ?? '(nenhum)'}). Usa a conta certa.`);
    process.exit(1);
  }
  console.log('Clientes autenticados com sucesso (anon, authenticated de teste, admin confirmado).');

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
    console.error('STOP: não foi possível criar a fixture de activities:', createError?.message);
    process.exit(1);
  }
  const fixtureId: string = fixture.id;
  createdFixtures.push({ table: 'activities', id: fixtureId });
  console.log(`Fixture activities criada: ${fixtureId}`);

  const venueFixtureId = await createFixtureQuiet(serviceClient, 'venues', {
    name: `${FIXTURE_MARKER} — venue`, source_key: 'legacy', product_key: 'legacy', engine_status: 'active',
  });
  const partnerFixtureId = await createFixtureQuiet(serviceClient, 'partners', {
    name: `${FIXTURE_MARKER} — partner`, active: true,
  });
  // categories exige uma coluna "key" not-null (descoberto na execução
  // anterior) — incluída aqui com um valor único e claramente marcado.
  const categoryFixtureId = await createFixtureQuiet(serviceClient, 'categories', {
    key: `security_test_${Date.now()}`,
    label_pt: `${FIXTURE_MARKER} — category`,
    label_en: `${FIXTURE_MARKER} — category`,
    emoji: '🔒',
  });

  try {
    await testSelect('anon SELECT fixture', anonClient, fixtureId);
    await testSelect('authenticated SELECT fixture', authedClient, fixtureId);

    await testUpdateCount('authenticated interested_count +1', authedClient, fixtureId, 1, 'ALLOWED');
    await testUpdateCount('authenticated interested_count -1 (volta a 0)', authedClient, fixtureId, -1, 'ALLOWED');
    await testUpdateCount('authenticated interested_count +10 arbitrário', authedClient, fixtureId, 10, 'DENIED');
    await testUpdateNull('authenticated interested_count NULL', authedClient, fixtureId);

    await testUpdateField('authenticated UPDATE title', authedClient, fixtureId, { title: 'HACKED' });
    await testUpdateField('authenticated UPDATE product_key', authedClient, fixtureId, { product_key: 'vivere-60-mais' });
    await testUpdateField('authenticated UPDATE recurrence_type', authedClient, fixtureId, { recurrence_type: 'weekly' });

    await testInsert('authenticated INSERT activity', authedClient, serviceClient);
    await testInsert('anon INSERT activity', anonClient, serviceClient);
    await testDelete('authenticated DELETE fixture (NÃO deve apagar)', authedClient, fixtureId);

    await testPrivilegedOnFixture('authenticated UPDATE venues (fixture, deve negar)', authedClient, serviceClient, 'venues', venueFixtureId, 'name');
    await testPrivilegedOnFixture('authenticated UPDATE partners (fixture, deve negar)', authedClient, serviceClient, 'partners', partnerFixtureId, 'name');
    await testPrivilegedOnFixture('authenticated UPDATE categories (fixture, deve negar)', authedClient, serviceClient, 'categories', categoryFixtureId, 'label_pt');

    await testUpdateField(
      'admin UPDATE title (deve permitir)', adminClient, fixtureId,
      { title: `${FIXTURE_MARKER} — editado por admin` }, 'ALLOWED',
    );
    if (venueFixtureId) {
      await testAdminPrivilegedOnFixture('admin UPDATE venues fixture (deve permitir)', adminClient, serviceClient, 'venues', venueFixtureId, 'name');
    }

    const { data: finalState } = await serviceClient
      .from('activities')
      .select('id, title, interested_count, product_key, recurrence_type')
      .eq('id', fixtureId)
      .single();
    console.log('Estado final da fixture activities (deve reflectir só a edição do admin):', finalState);

  } finally {
    await cleanupAll(serviceClient);
  }

  console.log('\n=== RESULTADOS ===');
  let anyFail = false;
  for (const r of results) {
    const pass = r.actual === r.expected;
    if (!pass) anyFail = true;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${r.name} — esperado ${r.expected}, obtido ${r.actual}${r.detail ? ` (${r.detail})` : ''}`);
  }

  let residual = 0;
  for (const table of ['activities', 'venues', 'partners', 'categories'] as const) {
    const nameCol = table === 'activities' ? 'title' : table === 'venues' ? 'name' : table === 'partners' ? 'name' : 'label_pt';
    const { data: leftovers } = await serviceClient.from(table).select('id').ilike(nameCol, `${FIXTURE_MARKER}%`);
    if (leftovers && leftovers.length > 0) {
      residual += leftovers.length;
      console.error(`FAIL-CLOSED: ${leftovers.length} fixture(s) residual(is) em ${table}:`, leftovers.map(l => l.id));
    }
  }
  console.log(`\nSECURITY_TEST fixtures remaining (varredura final): ${residual}`);
  if (residual > 0) anyFail = true;

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

async function createFixtureQuiet(
  serviceClient: SupabaseClient, table: string, row: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await serviceClient.from(table).insert(row).select('id').single();
  if (error || !data) {
    console.error(`AVISO: não foi possível criar fixture em ${table} (schema pode diferir do esperado) — testes dessa tabela ficam inconclusivos:`, error?.message);
    return null;
  }
  createdFixtures.push({ table, id: data.id });
  console.log(`Fixture ${table} criada: ${data.id}`);
  return data.id;
}

async function cleanupAll(serviceClient: SupabaseClient): Promise<void> {
  for (const f of createdFixtures) {
    const { error } = await serviceClient.from(f.table).delete().eq('id', f.id);
    if (error) {
      console.error(`AVISO: falha ao limpar fixture ${f.table}/${f.id} — remover manualmente:`, error.message);
    } else {
      console.log(`Fixture ${f.table}/${f.id} removida.`);
    }
  }
}

async function testSelect(name: string, client: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await client.from('activities').select('id').eq('id', id).maybeSingle();
  record(name, 'ALLOWED', error ? 'ERROR' : data ? 'ALLOWED' : 'DENIED', error?.message);
}

async function testUpdateCount(
  name: string, client: SupabaseClient, id: string, delta: number, expected: 'ALLOWED' | 'DENIED',
): Promise<void> {
  const { data: before } = await client.from('activities').select('interested_count').eq('id', id).single();
  const { error } = await client.from('activities').update({ interested_count: (before?.interested_count ?? 0) + delta }).eq('id', id);
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

async function testInsert(name: string, client: SupabaseClient, serviceClient: SupabaseClient): Promise<void> {
  const { data, error } = await client
    .from('activities')
    .insert({ title: `${FIXTURE_MARKER} — nunca deve persistir`, source_key: 'legacy', product_key: 'legacy', engine_status: 'active' })
    .select('id')
    .maybeSingle();

  if (data?.id) {
    console.error(`AVISO GRAVE: INSERT por ${name} teve sucesso inesperadamente — limpando ${data.id} imediatamente`);
    const { error: cleanupError } = await serviceClient.from('activities').delete().eq('id', data.id);
    if (cleanupError) {
      console.error(`FALHA CRÍTICA DE CLEANUP: remover manualmente AGORA ${data.id}:`, cleanupError.message);
    }
  }
  record(name, 'DENIED', error ? 'DENIED' : 'ALLOWED', error?.message);
}

async function testDelete(name: string, client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('activities').delete().eq('id', id);
  const { data: stillThere } = await client.from('activities').select('id').eq('id', id).maybeSingle();
  record(name, 'DENIED', stillThere ? 'DENIED' : 'ALLOWED', error?.message);
}

/**
 * Testa UPDATE de uma sessão não-privilegiada contra uma FIXTURE
 * própria — nunca conteúdo real. CRÍTICO: um UPDATE bloqueado por RLS
 * não lança erro em Postgres, só não afecta nenhuma linha — por isso
 * esta função SEMPRE confirma o estado real via serviceClient depois
 * da tentativa, nunca confia só em `error`.
 */
async function testPrivilegedOnFixture(
  name: string, client: SupabaseClient, serviceClient: SupabaseClient,
  table: 'venues' | 'partners' | 'categories', fixtureId: string | null, nameCol: string,
): Promise<void> {
  if (!fixtureId) {
    record(name, 'DENIED', 'ERROR', `fixture de ${table} não disponível — inconclusivo`);
    return;
  }
  const attemptValue = `${FIXTURE_MARKER} — tentativa não privilegiada ${Date.now()}`;
  await client.from(table).update({ [nameCol]: attemptValue }).eq('id', fixtureId);

  const { data: actual } = await serviceClient.from(table).select(nameCol).eq('id', fixtureId).single();
  const didChange = (actual as Record<string, unknown> | null)?.[nameCol] === attemptValue;
  record(name, 'DENIED', didChange ? 'ALLOWED' : 'DENIED', didChange ? 'linha realmente mudou' : 'linha confirmada inalterada via service_role');
}

async function testAdminPrivilegedOnFixture(
  name: string, client: SupabaseClient, serviceClient: SupabaseClient,
  table: 'venues', fixtureId: string, nameCol: string,
): Promise<void> {
  const attemptValue = `${FIXTURE_MARKER} — editado por admin ${Date.now()}`;
  await client.from(table).update({ [nameCol]: attemptValue }).eq('id', fixtureId);

  const { data: actual } = await serviceClient.from(table).select(nameCol).eq('id', fixtureId).single();
  const didChange = (actual as Record<string, unknown> | null)?.[nameCol] === attemptValue;
  record(name, 'ALLOWED', didChange ? 'ALLOWED' : 'DENIED', didChange ? undefined : 'linha NÃO mudou, mas devia ter mudado');
}

main().catch((err) => {
  console.error('ERRO FATAL:', err);
  process.exit(1);
});
