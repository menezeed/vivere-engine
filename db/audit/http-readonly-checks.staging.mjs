// ============================================================
// Verificações HTTP SÓ DE LEITURA da Data API do staging (SEC-O-021)
//
// Confirma, através da API do Supabase (gateway + PostgREST), que os
// privilégios da 0023 funcionam para `anon` e que as negações continuam.
//
// GARANTIAS
//  * Só pedidos GET e HEAD. Nenhum POST/PATCH/PUT/DELETE existe neste
//    ficheiro: não há forma de escrever no banco.
//  * Host fixo: só https://jvtcgomwbfojsttepcfc.supabase.co (staging).
//    Qualquer outro alvo é recusado, incluindo o ref de produção.
//  * Chave lida da variável VIVERE_STAGING_PUBLISHABLE_KEY (definida a
//    partir de um prompt escondido, ver db/audit/README.md §3). Nunca é
//    impressa, nem parcialmente. Recusa sb_secret_ e JWT que não sejam
//    role=anon do staging.
//  * Só envia o cabeçalho `apikey` (nunca Authorization).
//  * Nunca imprime corpos de resposta: só HTTP status, código de erro
//    PostgREST e número de linhas. Sem dados pessoais na saída.
//  * Redirecionamentos recusados (redirect: 'error'), timeout de 15 s.
//
// Uso (staging):  node http-readonly-checks.staging.mjs
// Auto-teste local (PostgREST em 127.0.0.1, sem gateway):
//                 node http-readonly-checks.staging.mjs --local-selftest <porta>
// ============================================================
const STAGING_REF = 'jvtcgomwbfojsttepcfc';
const PRODUCTION_REF = 'ccpqngyupukdefaqvzgl';
const args = process.argv.slice(2);
const local = args[0] === '--local-selftest';
let BASE, REST;
if (local) {
  const port = Number(args[1]);
  if (!Number.isInteger(port) || port < 1024) throw new Error('porta local inválida');
  BASE = `http://127.0.0.1:${port}`; REST = BASE;
} else {
  if (args.length) throw new Error('sem argumentos em modo staging');
  BASE = `https://${STAGING_REF}.supabase.co`; REST = `${BASE}/rest/v1`;
}
if (BASE.includes(PRODUCTION_REF)) throw new Error('RECUSADO: ref de produção');

function loadKey() {
  if (local) return 'local-selftest-sem-chave';
  const k = process.env.VIVERE_STAGING_PUBLISHABLE_KEY ?? '';
  if (!k) throw new Error('VIVERE_STAGING_PUBLISHABLE_KEY não definida (ver db/audit/README.md §3)');
  if (/^sb_secret_/.test(k)) throw new Error('RECUSADO: chave secreta (sb_secret_). Usar só a publishable.');
  if (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k)) return k;
  const parts = k.split('.');
  if (parts.length === 3) {
    let p; try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw new Error('RECUSADO: JWT ilegível'); }
    if (p.role !== 'anon') throw new Error(`RECUSADO: JWT com role=${p.role === 'service_role' ? 'service_role' : 'outro'}; só anon`);
    if (p.ref !== STAGING_REF) throw new Error('RECUSADO: JWT de outro projecto (ref diferente do staging)');
    return k;
  }
  throw new Error('RECUSADO: formato de chave não reconhecido (esperado sb_publishable_ ou JWT anon do staging)');
}
let KEY;
try { KEY = loadKey(); } catch (e) { console.error(e.message); process.exit(2); }
const describeKey = local ? 'nenhuma (auto-teste local)' : KEY.startsWith('sb_publishable_') ? 'publishable (sb_publishable_), valor oculto' : 'JWT anon do staging, valor oculto';

async function req(id, path, { method = 'GET', withKey = true, profile, count, expect, note = '', gatewayOnly = false }) {
  if (!['GET', 'HEAD'].includes(method)) throw new Error('método proibido');
  if (local && gatewayOnly) return { id, path, expect: expect.join('|'), got: 'SALTADO (só gateway)', ok: null, note };
  const headers = {};
  if (withKey && !local) headers.apikey = KEY;
  if (profile) headers['Accept-Profile'] = profile;
  if (count) headers.Prefer = 'count=exact';
  let status, code = '', rows = '';
  try {
    const r = await fetch((path.startsWith('/') ? REST : BASE) + path, { method, headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    status = r.status;
    if (method === 'HEAD') rows = (r.headers.get('content-range') ?? '-').replace(/^.*\//, 'total=');
    else { const t = await r.text(); try { const j = JSON.parse(t); if (Array.isArray(j)) rows = `linhas=${j.length}`; else code = j.code ?? j.error ?? ''; } catch { /* corpo não JSON: ignorado, nunca impresso */ } }
  } catch (e) { status = 'ERRO'; code = e.name; }
  const got = `${status}${code ? ' ' + code : ''}`;
  return { id, path, expect: expect.join('|'), got: `${got}${rows ? ' ' + rows : ''}`, ok: expect.some((e) => got.startsWith(e)), note };
}

const C = [
  // Positivos: o app precisa (0023 / 0000)
  ['R1', '/categories?select=id&limit=1', { expect: ['200'], note: '0023' }],
  ['R2', '/venues?select=id&limit=1', { expect: ['200'], note: '0023' }],
  ['R3', '/partners?select=id&limit=1', { expect: ['200'], note: '0023' }],
  ['R4', '/active_activities?select=id,venues(name)&limit=1', { expect: ['200'], note: 'vista + embed venues (0000+0023)' }],
  ['R5', '/activities?select=id&limit=1', { expect: ['200'], note: '0000' }],
  ['R6', '/categories?select=id', { method: 'HEAD', count: true, expect: ['200', '206'], note: 'contagem' }],
  // Negativos: tem de continuar negado (só leitura)
  ['N1', '/favorites?select=id&limit=1', { expect: ['401 42501', '403 42501'], note: 'anon sem favoritos' }],
  ['N2', '/activity_interests?select=user_id,device_id&limit=1', { expect: ['401 42501', '403 42501'], note: '0024 bloqueada: sem exposição' }],
  ['N3', '/suggestions?select=id&limit=1', { expect: ['401 42501', '403 42501'], note: 'só INSERT, sem leitura' }],
  ['N4', '/users?select=id&limit=1', { expect: ['401 42501', '403 42501'], note: 'vista sobre auth.users' }],
  ['N5', '/products?select=*&limit=1', { expect: ['401 42501', '403 42501'], note: 'tabela do Engine' }],
  ['N6', '/ingestion_runs?select=id&limit=1', { profile: 'staging', expect: ['406', '401 42501', '403 42501'], note: 'schema staging' }],
  ['N7', '/categories?select=id&limit=1', { withKey: false, expect: ['401'], note: 'sem apikey: gateway recusa', gatewayOnly: true }],
];

console.log(`Alvo: ${local ? BASE + ' (AUTO-TESTE LOCAL)' : BASE} | chave: ${describeKey} | métodos: GET/HEAD`);
const results = [];
for (const [id, path, o] of C) results.push(await req(id, path, o));
for (const r of results) console.log(`${r.ok === null ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(3)} ${r.path.padEnd(52)} esperado=${r.expect.padEnd(26)} obtido=${r.got}${r.note ? '  (' + r.note + ')' : ''}`);
const done = results.filter((r) => r.ok !== null);
console.log(`TOTAL ${done.filter((r) => r.ok).length}/${done.length}${results.length > done.length ? ` (${results.length - done.length} só no gateway, saltados localmente)` : ''}`);
process.exit(done.every((r) => r.ok) ? 0 : 1);
