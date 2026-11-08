// Lote 2: testes ponta-a-ponta SÓ LOCAIS das RPC 0024/0025 através do PostgREST.
// Só fala com http://127.0.0.1:<porta>. Tokens HS256 assinados com o segredo LOCAL do
// PostgREST de teste (ficheiro passado como argumento); nunca são impressos.
// Pré-requisito: base com supabase-sim.sql + 0000..0025 e as fixtures de
// lote2-http-e2e.fixtures.local.sql (utilizadores, sessões, actividades).
// Uso: node lote2-http-e2e.local.mjs <porta> <ficheiro-jwt-secret>
// NOTA: o PostgREST 14 devolve HTTP 500 para SQLSTATE P0002 (só P0001 tem mapeamento
// próprio); a app deve decidir pelo campo `code` do corpo, não pelo status HTTP.
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [port, secretFile] = process.argv.slice(2);
if (!/^\d+$/.test(port ?? '') || !secretFile) throw new Error('uso: <porta> <ficheiro-jwt-secret>');
const BASE = `http://127.0.0.1:${port}`;
const secret = readFileSync(secretFile, 'utf8').trim();

// Fixtures (iguais às de lote2-http-e2e.fixtures.local.sql)
const U = { A: '00000000-0000-4000-8000-0000000003a1', B: '00000000-0000-4000-8000-0000000003b1',
  M: '00000000-0000-4000-8000-0000000003c1', D: '00000000-0000-4000-8000-0000000003d1' };
const S = { A: '10000000-0000-4000-8000-0000000003a1', M: '10000000-0000-4000-8000-0000000003c1',
  Dfresh: '10000000-0000-4000-8000-0000000003d1', Dold: '10000000-0000-4000-8000-0000000003d2' };
const ACT = '20000000-0000-4000-8000-0000000003a1';     // activa, interested_count = 10
const OLD = '20000000-0000-4000-8000-0000000003a2';     // inactiva

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub, sessionId, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 600, aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }] };
  if (sessionId) claims.session_id = sessionId;
  Object.assign(claims, extra);
  const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64(claims);
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}

const results = [];
async function req(id, who, method, path, { body, expect, check, note = '' }) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${jwt(...who)}`;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch { /* corpo vazio */ }
  const code = j && !Array.isArray(j) && j.code ? ` ${j.code}` : '';
  const msg = j && !Array.isArray(j) && j.message ? ` ${j.message}` : '';
  const got = `${r.status}${code}${msg}`;
  let ok = expect.some((e) => got.startsWith(e));
  let extra = '';
  if (ok && check) { const c = check(j); ok = c === true; if (c !== true) extra = ` check=${c}`; }
  results.push({ id, who: who ? 'auth' : 'anon', path, expect: expect.join('|'), got: got.slice(0, 60) + extra, ok, note,
    body: Array.isArray(j) ? JSON.stringify(j).slice(0, 80) : '' });
  return j;
}
const ids = (j) => (Array.isArray(j) ? j.map((x) => (typeof x === 'string' ? x : x.get_my_interests)).sort() : null);
const one = (j, i, c) => (Array.isArray(j) && j.length === 1 && j[0].interested === i && j[0].interested_count === c) || JSON.stringify(j);

// ---- anon: tudo negado ----
await req('H01', null, 'POST', '/rpc/set_activity_interest', { body: { p_activity_id: ACT, p_interested: true }, expect: ['401 42501'] });
await req('H02', null, 'POST', '/rpc/get_my_interests', { body: { p_activity_ids: [ACT] }, expect: ['401 42501'] });
await req('H03', null, 'POST', '/rpc/delete_my_account', { body: {}, expect: ['401 42501'] });
await req('H04', null, 'POST', '/rpc/increment_activity_interest', { body: { p_activity_id: ACT, p_delta: 1 }, expect: ['401 42501'] });
await req('H05', null, 'PATCH', `/activities?id=eq.${ACT}`, { body: { interested_count: 11 }, expect: ['401 42501'] });
await req('H06', null, 'POST', '/active_activities', { body: { title: 'Lote2 nunca' }, expect: ['401 42501'] });
await req('H07', null, 'GET', `/active_activities?select=id,interested_count&id=eq.${ACT}`, { expect: ['200'],
  check: (j) => (j?.[0]?.interested_count === 10) || JSON.stringify(j) });
await req('H08', null, 'GET', '/activity_interests?select=user_id', { expect: ['401 42501'] });

// ---- authenticated A: interesses ----
const A = [U.A, S.A];
await req('H09', A, 'POST', '/rpc/set_activity_interest', { body: { p_activity_id: ACT, p_interested: true }, expect: ['200'], check: (j) => one(j, true, 11) });
await req('H10', A, 'POST', '/rpc/set_activity_interest', { body: { p_activity_id: ACT, p_interested: true }, expect: ['200'], check: (j) => one(j, true, 11), note: 'idempotente' });
await req('H11', A, 'POST', '/rpc/get_my_interests', { body: { p_activity_ids: [ACT, OLD, randomUUID()] }, expect: ['200'],
  check: (j) => JSON.stringify(ids(j)) === JSON.stringify([ACT]) || JSON.stringify(j) });
await req('H12', [U.B], 'POST', '/rpc/get_my_interests', { body: { p_activity_ids: [ACT] }, expect: ['200'],
  check: (j) => (Array.isArray(j) && j.length === 0) || JSON.stringify(j), note: 'B não vê o interesse de A' });
await req('H13', A, 'POST', '/rpc/set_activity_interest', { body: { p_activity_id: ACT, p_interested: false }, expect: ['200'], check: (j) => one(j, false, 10) });
await req('H14', A, 'POST', '/rpc/set_activity_interest', { body: { p_activity_id: ACT, p_interested: false }, expect: ['200'], check: (j) => one(j, false, 10), note: 'idempotente' });
await req('H15', A, 'POST', '/rpc/set_activity_interest', { body: { p_activity_id: OLD, p_interested: true }, expect: ['500 P0002 activity_not_found'] });
await req('H16', A, 'POST', '/rpc/set_activity_interest', { body: { p_activity_id: randomUUID(), p_interested: true }, expect: ['500 P0002 activity_not_found'] });
await req('H17', A, 'POST', '/rpc/get_my_interests', { body: { p_activity_ids: Array.from({ length: 501 }, () => randomUUID()) }, expect: ['400 22023 too_many_ids'] });
await req('H18', A, 'POST', '/rpc/get_my_interests', { body: { p_activity_ids: [] }, expect: ['200'], check: (j) => (Array.isArray(j) && j.length === 0) || JSON.stringify(j) });
await req('H19', A, 'POST', '/rpc/increment_activity_interest', { body: { p_activity_id: ACT, p_delta: 1 }, expect: ['403 42501'] });
// authenticated mantém UPDATE (admin); sem a política compat o RLS filtra: 204 sem efeito (H24b confirma)
await req('H20', A, 'PATCH', `/activities?id=eq.${ACT}`, { body: { interested_count: 11 }, expect: ['204'] });
await req('H21', A, 'PATCH', `/active_activities?id=eq.${ACT}`, { body: { interested_count: 11 }, expect: ['403 42501'] });
await req('H22', A, 'DELETE', `/active_activities?id=eq.${ACT}`, { expect: ['403 42501'] });
await req('H23', A, 'POST', '/activity_interests', { body: { activity_id: ACT, user_id: U.A }, expect: ['403 42501'] });
await req('H24', A, 'GET', `/activities?select=id,interested_count&id=eq.${ACT}`, { expect: ['200'],
  check: (j) => (j?.length === 1 && j[0].interested_count === 10) || JSON.stringify(j), note: 'PATCH de H20 sem efeito' });
await req('H24b', [U.A, S.A, { is_anonymous: true }], 'POST', '/rpc/set_activity_interest', { body: { p_activity_id: ACT, p_interested: true }, expect: ['403 42501 not_authenticated'], note: 'sessão anónima' });
await req('H24c', [U.A, S.A, { app_metadata: { role: 'admin' } }], 'PATCH', `/activities?id=eq.${OLD}`, { body: { title: 'Lote2 HTTP inactiva (admin)' }, expect: ['204'] });
await req('H24d', null, 'GET', `/activities?select=title&id=eq.${OLD}`, { expect: ['200'],
  check: (j) => j?.[0]?.title === 'Lote2 HTTP inactiva (admin)' || JSON.stringify(j), note: 'admin edita via admin_role_all' });

// ---- delete_my_account ----
await req('H25', [U.D], 'POST', '/rpc/delete_my_account', { body: {}, expect: ['403 28000 reauthentication_required'], note: 'sem session_id' });
await req('H26', [U.D, S.Dold], 'POST', '/rpc/delete_my_account', { body: {}, expect: ['403 28000 reauthentication_required'], note: 'sessão de 10 min, refrescada' });
await req('H27', [U.D, S.A], 'POST', '/rpc/delete_my_account', { body: {}, expect: ['403 28000 reauthentication_required'], note: 'sessão de outro utilizador' });
await req('H28', [U.M, S.M], 'POST', '/rpc/delete_my_account', { body: {}, expect: ['403 42501 account_managed'] });
await req('H29', [U.D, S.Dfresh], 'POST', '/rpc/set_activity_interest', { body: { p_activity_id: ACT, p_interested: true }, expect: ['200'], check: (j) => one(j, true, 11) });
await req('H30', [U.D, S.Dfresh], 'POST', '/rpc/delete_my_account', { body: {}, expect: ['200', '204'] });
await req('H31', [U.D, S.Dfresh], 'POST', '/rpc/delete_my_account', { body: {}, expect: ['403 28000 reauthentication_required'], note: 'conta já apagada (sessão foi em cascata)' });
await req('H32', null, 'GET', `/active_activities?select=interested_count&id=eq.${ACT}`, { expect: ['200'],
  check: (j) => (j?.[0]?.interested_count === 11) || JSON.stringify(j), note: 'contador não decrementa na cascata (documentado)' });

for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.who.padEnd(4)} ${r.path.slice(0, 50).padEnd(50)} esperado=${r.expect.padEnd(36)} obtido=${r.got}${r.body ? ' ' + r.body : ''}${r.note ? '  (' + r.note + ')' : ''}`);
}
const okN = results.filter((r) => r.ok).length;
console.log(`LOTE2 HTTP E2E: ${okN} PASS, ${results.length - okN} FAIL de ${results.length}`);
process.exit(okN === results.length ? 0 : 1);
